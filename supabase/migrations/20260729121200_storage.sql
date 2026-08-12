-- =====================================================================
-- 20260729121200 — Storage
-- ---------------------------------------------------------------------
-- Único upload real do sistema: fotos do item recebido no balcão
-- (GradeFotos → onAdd, src/components/Fotos.tsx:57).
--
-- Bucket PRIVADO. Foto de item de cliente com endereço/chave visível não
-- pode ficar em URL pública adivinhável — o front usa URL assinada.
--
-- Convenção de caminho: <order_id>/<uuid>.<ext>
-- A policy depende desse prefixo, e order_photos tem a constraint
-- `order_photos_path_scoped` que garante a mesma coisa do outro lado.
-- =====================================================================

-- As colunas `public`, `file_size_limit` e `allowed_mime_types` são
-- adicionadas a storage.buckets pelas migrations do próprio storage-api,
-- que rodam quando o container sobe — DEPOIS desta migration na primeira
-- inicialização do volume. Por isso o bucket é criado com as colunas
-- mínimas e os limites são aplicados condicionalmente: assim a migration
-- funciona tanto no banco recém-criado quanto no já migrado, e
-- `docker compose down -v && up` reproduz o ambiente sem intervenção.
INSERT INTO "storage"."buckets" ("id", "name")
VALUES ('order-photos', 'order-photos')
ON CONFLICT ("id") DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'public'
  ) THEN
    EXECUTE $sql$ UPDATE storage.buckets SET "public" = false WHERE "id" = 'order-photos' $sql$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'file_size_limit'
  ) THEN
    -- 10 MB: foto de celular sem tratamento.
    EXECUTE $sql$ UPDATE storage.buckets SET "file_size_limit" = 10485760 WHERE "id" = 'order-photos' $sql$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'allowed_mime_types'
  ) THEN
    EXECUTE $sql$
      UPDATE storage.buckets
      SET "allowed_mime_types" = ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif']
      WHERE "id" = 'order-photos'
    $sql$;
  END IF;
END
$$;


-- ---------------------------------------------------------------------
-- Reaplicação dos limites depois que o storage-api migrar o schema
-- ---------------------------------------------------------------------
-- Chamada pelo healthcheck/bootstrap para garantir bucket privado com
-- limite de tamanho mesmo quando esta migration rodou antes do
-- storage-api criar as colunas.
CREATE OR REPLACE FUNCTION "public"."ensure_order_photos_bucket"() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  INSERT INTO storage.buckets ("id", "name")
  VALUES ('order-photos', 'order-photos')
  ON CONFLICT ("id") DO NOTHING;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets' AND column_name = 'public'
  ) THEN
    EXECUTE $sql$
      UPDATE storage.buckets
      SET "public" = false,
          "file_size_limit" = 10485760,
          "allowed_mime_types" = ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif']
      WHERE "id" = 'order-photos'
    $sql$;
  END IF;
END;
$$;

COMMENT ON FUNCTION "public"."ensure_order_photos_bucket"() IS
  'Garante bucket privado com limites. Idempotente; chamada pelo seed_prod após o storage-api migrar.';


-- ---------------------------------------------------------------------
-- Helper: o primeiro segmento do caminho é uma comanda visível?
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."storage_path_order_id"("p_name" text) RETURNS uuid
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_first text;
BEGIN
  v_first := split_part(coalesce(p_name, ''), '/', 1);
  IF v_first ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN v_first::uuid;
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION "public"."storage_path_order_id"(text) IS
  'Extrai o order_id do prefixo do caminho. Retorna NULL se o caminho não seguir a convenção.';


-- =====================================================================
-- Policies do bucket
-- ---------------------------------------------------------------------
-- Espelham exatamente a RLS de order_photos: quem vê a comanda vê a
-- foto; quem trabalha na comanda envia e remove.
-- =====================================================================

CREATE POLICY "order_photos_storage_select" ON "storage"."objects"
    FOR SELECT TO "authenticated"
    USING (
      "bucket_id" = 'order-photos'
      AND ("public"."can_read"('orders') OR "public"."can_read"('production'))
      -- Caminho fora da convenção não é legível: evita objeto órfão
      -- servindo como área de upload genérica.
      AND EXISTS (
        SELECT 1 FROM "public"."orders" o
        WHERE o."id" = "public"."storage_path_order_id"("name")
          AND o."deleted_at" IS NULL
      )
    );

CREATE POLICY "order_photos_storage_insert" ON "storage"."objects"
    FOR INSERT TO "authenticated"
    WITH CHECK (
      "bucket_id" = 'order-photos'
      AND (
        "public"."can_write"('orders')
        OR "public"."can_write"('production')
        OR "public"."can_write"('service_desk')
      )
      -- Só anexa em comanda existente e não finalizada.
      AND EXISTS (
        SELECT 1
        FROM "public"."orders" o
        JOIN "public"."order_statuses" st ON st."key" = o."status_key"
        WHERE o."id" = "public"."storage_path_order_id"("name")
          AND o."deleted_at" IS NULL
          AND NOT st."is_final"
      )
    );

CREATE POLICY "order_photos_storage_update" ON "storage"."objects"
    FOR UPDATE TO "authenticated"
    USING (
      "bucket_id" = 'order-photos'
      AND ("public"."can_write"('orders') OR "public"."can_write"('production'))
    )
    WITH CHECK (
      "bucket_id" = 'order-photos'
      AND ("public"."can_write"('orders') OR "public"."can_write"('production'))
    );

CREATE POLICY "order_photos_storage_delete" ON "storage"."objects"
    FOR DELETE TO "authenticated"
    USING (
      "bucket_id" = 'order-photos'
      AND ("public"."can_write"('orders') OR "public"."can_write"('production'))
    );


-- ---------------------------------------------------------------------
-- Limpeza: apagar a linha apaga o objeto
-- ---------------------------------------------------------------------
-- Sem isso, cada foto removida na UI e cada comanda excluída deixariam
-- binário órfão no bucket, crescendo para sempre.
CREATE OR REPLACE FUNCTION "public"."trg_order_photo_cleanup_storage"() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF OLD."storage_path" IS NOT NULL THEN
    DELETE FROM storage.objects
    WHERE "bucket_id" = 'order-photos' AND "name" = OLD."storage_path";
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "order_photos_cleanup_storage"
    AFTER DELETE ON "public"."order_photos"
    FOR EACH ROW EXECUTE FUNCTION "public"."trg_order_photo_cleanup_storage"();

COMMENT ON FUNCTION "public"."trg_order_photo_cleanup_storage"() IS
  'Remove o binário quando a linha de order_photos sai (inclusive via CASCADE de orders).';

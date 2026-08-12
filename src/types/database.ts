// =====================================================================
// GERADO AUTOMATICAMENTE — NÃO EDITE À MÃO
// ---------------------------------------------------------------------
// Regenere depois de QUALQUER migration:
//     npm run db:types
// =====================================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      app_settings: {
        Row: {
          abandoned_after_days: number
          company_address: string
          company_hours: string
          company_name: string
          company_owner: string
          company_phone: string
          created_at: string
          id: boolean
          label_default_size: string
          label_show_qr: boolean
          label_show_staff: boolean
          labels_per_sheet: number
          order_footer_text: string
          order_next_number: number
          order_prefix: string
          order_show_notes: boolean
          order_show_photo: boolean
          require_photo_on_delivery: boolean
          require_photo_on_intake: boolean
          updated_at: string
        }
        Insert: {
          abandoned_after_days?: number
          company_address?: string
          company_hours?: string
          company_name?: string
          company_owner?: string
          company_phone?: string
          created_at?: string
          id?: boolean
          label_default_size?: string
          label_show_qr?: boolean
          label_show_staff?: boolean
          labels_per_sheet?: number
          order_footer_text?: string
          order_next_number?: number
          order_prefix?: string
          order_show_notes?: boolean
          order_show_photo?: boolean
          require_photo_on_delivery?: boolean
          require_photo_on_intake?: boolean
          updated_at?: string
        }
        Update: {
          abandoned_after_days?: number
          company_address?: string
          company_hours?: string
          company_name?: string
          company_owner?: string
          company_phone?: string
          created_at?: string
          id?: boolean
          label_default_size?: string
          label_show_qr?: boolean
          label_show_staff?: boolean
          labels_per_sheet?: number
          order_footer_text?: string
          order_next_number?: number
          order_prefix?: string
          order_show_notes?: boolean
          order_show_photo?: boolean
          require_photo_on_delivery?: boolean
          require_photo_on_intake?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      approval_channels: {
        Row: {
          created_at: string
          key: string
          label: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          key: string
          label: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          key?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string
          actor_role: string | null
          after: Json | null
          before: Json | null
          created_at: string
          id: string
          metadata: Json
          resource_id: string | null
          resource_type: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string
          actor_role?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          metadata?: Json
          resource_id?: string | null
          resource_type: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string
          actor_role?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          metadata?: Json
          resource_id?: string | null
          resource_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_statuses: {
        Row: {
          bg_color: string
          color: string
          created_at: string
          is_derived: boolean
          key: string
          label: string
          sort_order: number
        }
        Insert: {
          bg_color: string
          color: string
          created_at?: string
          is_derived?: boolean
          key: string
          label: string
          sort_order?: number
        }
        Update: {
          bg_color?: string
          color?: string
          created_at?: string
          is_derived?: boolean
          key?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      customers: {
        Row: {
          city: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          email: string
          id: string
          name: string
          notes: string
          phone: string
          status_key: string
          updated_at: string
          whatsapp: string
        }
        Insert: {
          city?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string
          id?: string
          name: string
          notes?: string
          phone: string
          status_key?: string
          updated_at?: string
          whatsapp?: string
        }
        Update: {
          city?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string
          id?: string
          name?: string
          notes?: string
          phone?: string
          status_key?: string
          updated_at?: string
          whatsapp?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_status_key_fkey"
            columns: ["status_key"]
            isOneToOne: false
            referencedRelation: "customer_statuses"
            referencedColumns: ["key"]
          },
        ]
      }
      integrations: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          description: string
          enabled: boolean
          id: string
          key: string
          kind: string
          last_checked_at: string | null
          last_error: string | null
          last_status: string | null
          name: string
          provider: string
          secret_ref: string | null
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          description?: string
          enabled?: boolean
          id?: string
          key: string
          kind: string
          last_checked_at?: string | null
          last_error?: string | null
          last_status?: string | null
          name: string
          provider?: string
          secret_ref?: string | null
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          description?: string
          enabled?: boolean
          id?: string
          key?: string
          kind?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_status?: string | null
          name?: string
          provider?: string
          secret_ref?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_categories: {
        Row: {
          active: boolean
          auto_for_service_category: string | null
          created_at: string
          deleted_at: string | null
          id: string
          is_system: boolean
          kind: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          auto_for_service_category?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_system?: boolean
          kind: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          auto_for_service_category?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_system?: boolean
          kind?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_categories_auto_for_service_category_fkey"
            columns: ["auto_for_service_category"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["key"]
          },
        ]
      }
      ledger_entries: {
        Row: {
          amount: number
          auto_generated: boolean
          auto_role: string | null
          category_id: string
          created_at: string
          created_by: string | null
          customer_id: string | null
          deleted_at: string | null
          description: string
          entry_date: string
          id: string
          kind: string
          method_key: string | null
          note: string
          order_id: string | null
          staff_id: string | null
          status_key: string
          updated_at: string
        }
        Insert: {
          amount: number
          auto_generated?: boolean
          auto_role?: string | null
          category_id: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deleted_at?: string | null
          description: string
          entry_date?: string
          id?: string
          kind: string
          method_key?: string | null
          note?: string
          order_id?: string | null
          staff_id?: string | null
          status_key: string
          updated_at?: string
        }
        Update: {
          amount?: number
          auto_generated?: boolean
          auto_role?: string | null
          category_id?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deleted_at?: string | null
          description?: string
          entry_date?: string
          id?: string
          kind?: string
          method_key?: string | null
          note?: string
          order_id?: string | null
          staff_id?: string | null
          status_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "ledger_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_summary_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_method_key_fkey"
            columns: ["method_key"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "ledger_entries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_list_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_status_key_fkey"
            columns: ["status_key"]
            isOneToOne: false
            referencedRelation: "ledger_statuses"
            referencedColumns: ["key"]
          },
        ]
      }
      ledger_statuses: {
        Row: {
          bg_color: string
          color: string
          counts_as_open: boolean
          counts_as_received: boolean
          created_at: string
          is_final: boolean
          key: string
          label: string
          sort_order: number
        }
        Insert: {
          bg_color: string
          color: string
          counts_as_open?: boolean
          counts_as_received?: boolean
          created_at?: string
          is_final?: boolean
          key: string
          label: string
          sort_order?: number
        }
        Update: {
          bg_color?: string
          color?: string
          counts_as_open?: boolean
          counts_as_received?: boolean
          created_at?: string
          is_final?: boolean
          key?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      modules: {
        Row: {
          created_at: string
          key: string
          label: string
          nav_group: string
          route: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          key: string
          label: string
          nav_group: string
          route: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          key?: string
          label?: string
          nav_group?: string
          route?: string
          sort_order?: number
        }
        Relationships: []
      }
      order_events: {
        Row: {
          actor_id: string | null
          actor_name: string
          created_at: string
          detail: string | null
          id: string
          order_id: string
          title: string
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string
          created_at?: string
          detail?: string | null
          id?: string
          order_id: string
          title: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string
          created_at?: string
          detail?: string | null
          id?: string
          order_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_list_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          approval_channel_key: string | null
          approval_taken_by: string | null
          approved_amount: number | null
          approved_at: string | null
          approved_by_name: string
          assigned_staff_id: string | null
          category_key: string
          created_at: string
          created_by: string | null
          delivered_at: string | null
          delivered_by: string | null
          delivered_to_document: string
          delivered_to_name: string
          delivery_note: string
          description: string
          due_date: string
          id: string
          is_rework: boolean | null
          label_printed: boolean
          order_id: string
          parent_item_id: string | null
          position: number
          quantity: number
          ready_at: string | null
          service_id: string | null
          service_name: string
          status_key: string
          total_amount: number
          updated_at: string
          warranty_days: number
        }
        Insert: {
          approval_channel_key?: string | null
          approval_taken_by?: string | null
          approved_amount?: number | null
          approved_at?: string | null
          approved_by_name?: string
          assigned_staff_id?: string | null
          category_key: string
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          delivered_by?: string | null
          delivered_to_document?: string
          delivered_to_name?: string
          delivery_note?: string
          description?: string
          due_date: string
          id?: string
          is_rework?: boolean | null
          label_printed?: boolean
          order_id: string
          parent_item_id?: string | null
          position?: number
          quantity?: number
          ready_at?: string | null
          service_id?: string | null
          service_name: string
          status_key?: string
          total_amount: number
          updated_at?: string
          warranty_days?: number
        }
        Update: {
          approval_channel_key?: string | null
          approval_taken_by?: string | null
          approved_amount?: number | null
          approved_at?: string | null
          approved_by_name?: string
          assigned_staff_id?: string | null
          category_key?: string
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          delivered_by?: string | null
          delivered_to_document?: string
          delivered_to_name?: string
          delivery_note?: string
          description?: string
          due_date?: string
          id?: string
          is_rework?: boolean | null
          label_printed?: boolean
          order_id?: string
          parent_item_id?: string | null
          position?: number
          quantity?: number
          ready_at?: string | null
          service_id?: string | null
          service_name?: string
          status_key?: string
          total_amount?: number
          updated_at?: string
          warranty_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_approval_channel_key_fkey"
            columns: ["approval_channel_key"]
            isOneToOne: false
            referencedRelation: "approval_channels"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "order_items_approval_taken_by_fkey"
            columns: ["approval_taken_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_assigned_staff_id_fkey"
            columns: ["assigned_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_category_key_fkey"
            columns: ["category_key"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "order_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_delivered_by_fkey"
            columns: ["delivered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_list_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_parent_item_id_fkey"
            columns: ["parent_item_id"]
            isOneToOne: false
            referencedRelation: "order_item_approval_view"
            referencedColumns: ["order_item_id"]
          },
          {
            foreignKeyName: "order_items_parent_item_id_fkey"
            columns: ["parent_item_id"]
            isOneToOne: false
            referencedRelation: "order_item_warranty_view"
            referencedColumns: ["order_item_id"]
          },
          {
            foreignKeyName: "order_items_parent_item_id_fkey"
            columns: ["parent_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_status_key_fkey"
            columns: ["status_key"]
            isOneToOne: false
            referencedRelation: "order_statuses"
            referencedColumns: ["key"]
          },
        ]
      }
      order_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          method_key: string
          note: string
          order_id: string
          paid_at: string
          received_by_staff_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          method_key: string
          note?: string
          order_id: string
          paid_at?: string
          received_by_staff_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          method_key?: string
          note?: string
          order_id?: string
          paid_at?: string
          received_by_staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_payments_method_key_fkey"
            columns: ["method_key"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "order_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_list_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_payments_received_by_staff_id_fkey"
            columns: ["received_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      order_photos: {
        Row: {
          caption: string
          created_at: string
          created_by: string | null
          gradient_seed: string
          id: string
          kind: string
          order_id: string
          order_item_id: string | null
          storage_path: string | null
        }
        Insert: {
          caption?: string
          created_at?: string
          created_by?: string | null
          gradient_seed?: string
          id?: string
          kind?: string
          order_id: string
          order_item_id?: string | null
          storage_path?: string | null
        }
        Update: {
          caption?: string
          created_at?: string
          created_by?: string | null
          gradient_seed?: string
          id?: string
          kind?: string
          order_id?: string
          order_item_id?: string | null
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_photos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_photos_kind_fkey"
            columns: ["kind"]
            isOneToOne: false
            referencedRelation: "photo_kinds"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "order_photos_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_list_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_photos_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_photos_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_item_approval_view"
            referencedColumns: ["order_item_id"]
          },
          {
            foreignKeyName: "order_photos_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_item_warranty_view"
            referencedColumns: ["order_item_id"]
          },
          {
            foreignKeyName: "order_photos_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      order_statuses: {
        Row: {
          bg_color: string
          border_color: string
          color: string
          created_at: string
          description: string
          in_kanban: boolean
          is_final: boolean
          is_open: boolean
          key: string
          label: string
          sort_order: number
        }
        Insert: {
          bg_color: string
          border_color: string
          color: string
          created_at?: string
          description?: string
          in_kanban?: boolean
          is_final?: boolean
          is_open?: boolean
          key: string
          label: string
          sort_order?: number
        }
        Update: {
          bg_color?: string
          border_color?: string
          color?: string
          created_at?: string
          description?: string
          in_kanban?: boolean
          is_final?: boolean
          is_open?: boolean
          key?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      orders: {
        Row: {
          amount_paid: number
          assigned_staff_id: string | null
          balance: number | null
          category_key: string
          created_at: string
          created_by: string | null
          customer_id: string
          deleted_at: string | null
          delivered_at: string | null
          delivered_by: string | null
          delivered_to_document: string
          delivered_to_name: string
          delivery_note: string
          description: string
          down_payment: number
          down_payment_method_key: string | null
          due_date: string
          id: string
          is_rework: boolean
          is_settled: boolean | null
          label_printed: boolean
          notes: string
          number: number
          order_printed: boolean
          quantity: number
          ready_at: string | null
          service_id: string | null
          service_name: string
          status_key: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          amount_paid?: number
          assigned_staff_id?: string | null
          balance?: number | null
          category_key: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          deleted_at?: string | null
          delivered_at?: string | null
          delivered_by?: string | null
          delivered_to_document?: string
          delivered_to_name?: string
          delivery_note?: string
          description?: string
          down_payment?: number
          down_payment_method_key?: string | null
          due_date: string
          id?: string
          is_rework?: boolean
          is_settled?: boolean | null
          label_printed?: boolean
          notes?: string
          number: number
          order_printed?: boolean
          quantity?: number
          ready_at?: string | null
          service_id?: string | null
          service_name: string
          status_key?: string
          total_amount: number
          updated_at?: string
        }
        Update: {
          amount_paid?: number
          assigned_staff_id?: string | null
          balance?: number | null
          category_key?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          deleted_at?: string | null
          delivered_at?: string | null
          delivered_by?: string | null
          delivered_to_document?: string
          delivered_to_name?: string
          delivery_note?: string
          description?: string
          down_payment?: number
          down_payment_method_key?: string | null
          due_date?: string
          id?: string
          is_rework?: boolean
          is_settled?: boolean | null
          label_printed?: boolean
          notes?: string
          number?: number
          order_printed?: boolean
          quantity?: number
          ready_at?: string | null
          service_id?: string | null
          service_name?: string
          status_key?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_assigned_staff_id_fkey"
            columns: ["assigned_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_category_key_fkey"
            columns: ["category_key"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_summary_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_delivered_by_fkey"
            columns: ["delivered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_down_payment_method_key_fkey"
            columns: ["down_payment_method_key"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "orders_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_status_key_fkey"
            columns: ["status_key"]
            isOneToOne: false
            referencedRelation: "order_statuses"
            referencedColumns: ["key"]
          },
        ]
      }
      payment_methods: {
        Row: {
          active: boolean
          color: string
          created_at: string
          icon: string
          key: string
          label: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          color?: string
          created_at?: string
          icon?: string
          key: string
          label: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          color?: string
          created_at?: string
          icon?: string
          key?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      photo_kinds: {
        Row: {
          created_at: string
          default_caption: string
          key: string
          label: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          default_caption: string
          key: string
          label: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          default_caption?: string
          key?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          role_key: string
          staff_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          id: string
          is_active?: boolean
          role_key: string
          staff_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          role_key?: string
          staff_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_role_key_fkey"
            columns: ["role_key"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "profiles_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      role_modules: {
        Row: {
          can_read: boolean
          can_write: boolean
          module_key: string
          role_key: string
        }
        Insert: {
          can_read?: boolean
          can_write?: boolean
          module_key: string
          role_key: string
        }
        Update: {
          can_read?: boolean
          can_write?: boolean
          module_key?: string
          role_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_modules_module_key_fkey"
            columns: ["module_key"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "role_modules_role_key_fkey"
            columns: ["role_key"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["key"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          description: string
          is_readonly: boolean
          key: string
          label: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          description?: string
          is_readonly?: boolean
          key: string
          label: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          description?: string
          is_readonly?: boolean
          key?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      service_categories: {
        Row: {
          active: boolean
          bg_color: string
          color: string
          created_at: string
          icon: string
          key: string
          label: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          bg_color: string
          color: string
          created_at?: string
          icon?: string
          key: string
          label: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          bg_color?: string
          color?: string
          created_at?: string
          icon?: string
          key?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      services: {
        Row: {
          active: boolean
          base_price: number
          category_key: string
          created_at: string
          created_by: string | null
          default_staff_id: string | null
          deleted_at: string | null
          description: string
          id: string
          lead_time_days: number
          name: string
          notes: string
          updated_at: string
          warranty_days: number
        }
        Insert: {
          active?: boolean
          base_price?: number
          category_key: string
          created_at?: string
          created_by?: string | null
          default_staff_id?: string | null
          deleted_at?: string | null
          description?: string
          id?: string
          lead_time_days?: number
          name: string
          notes?: string
          updated_at?: string
          warranty_days?: number
        }
        Update: {
          active?: boolean
          base_price?: number
          category_key?: string
          created_at?: string
          created_by?: string | null
          default_staff_id?: string | null
          deleted_at?: string | null
          description?: string
          id?: string
          lead_time_days?: number
          name?: string
          notes?: string
          updated_at?: string
          warranty_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "services_category_key_fkey"
            columns: ["category_key"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "services_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_default_staff_id_fkey"
            columns: ["default_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          active: boolean
          can_execute: boolean
          created_at: string
          deleted_at: string | null
          id: string
          initials: string
          job_title: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          can_execute?: boolean
          created_at?: string
          deleted_at?: string | null
          id?: string
          initials?: string
          job_title?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          can_execute?: boolean
          created_at?: string
          deleted_at?: string | null
          id?: string
          initials?: string
          job_title?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      customer_summary_view: {
        Row: {
          city: string | null
          created_at: string | null
          email: string | null
          id: string | null
          last_order_at: string | null
          last_service_name: string | null
          name: string | null
          notes: string | null
          order_count: number | null
          pending_amount: number | null
          phone: string | null
          status_key: string | null
          total_spent: number | null
          updated_at: string | null
          whatsapp: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_status_key_fkey"
            columns: ["status_key"]
            isOneToOne: false
            referencedRelation: "customer_statuses"
            referencedColumns: ["key"]
          },
        ]
      }
      integration_status: {
        Row: {
          enabled: boolean | null
          key: string | null
          kind: string | null
          last_checked_at: string | null
          last_status: string | null
          name: string | null
        }
        Insert: {
          enabled?: boolean | null
          key?: string | null
          kind?: string | null
          last_checked_at?: string | null
          last_status?: string | null
          name?: string | null
        }
        Update: {
          enabled?: boolean | null
          key?: string | null
          kind?: string | null
          last_checked_at?: string | null
          last_status?: string | null
          name?: string | null
        }
        Relationships: []
      }
      ledger_list_view: {
        Row: {
          amount: number | null
          auto_generated: boolean | null
          auto_role: string | null
          category_id: string | null
          category_name: string | null
          created_at: string | null
          customer_id: string | null
          customer_name: string | null
          description: string | null
          entry_date: string | null
          id: string | null
          kind: string | null
          method_key: string | null
          note: string | null
          order_id: string | null
          order_number: number | null
          staff_id: string | null
          staff_name: string | null
          status_key: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "ledger_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_summary_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_method_key_fkey"
            columns: ["method_key"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "ledger_entries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_list_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_status_key_fkey"
            columns: ["status_key"]
            isOneToOne: false
            referencedRelation: "ledger_statuses"
            referencedColumns: ["key"]
          },
        ]
      }
      order_item_approval_view: {
        Row: {
          approval_channel_key: string | null
          approval_channel_label: string | null
          approval_difference: number | null
          approval_diverges: boolean | null
          approval_taken_by_name: string | null
          approved_amount: number | null
          approved_at: string | null
          approved_by_name: string | null
          order_id: string | null
          order_item_id: string | null
          order_number: number | null
          position: number | null
          service_name: string | null
          total_amount: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_approval_channel_key_fkey"
            columns: ["approval_channel_key"]
            isOneToOne: false
            referencedRelation: "approval_channels"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_list_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_warranty_view: {
        Row: {
          delivered_at: string | null
          in_warranty: boolean | null
          is_rework: boolean | null
          order_id: string | null
          order_item_id: string | null
          order_number: number | null
          parent_item_id: string | null
          position: number | null
          rework_count: number | null
          service_name: string | null
          warranty_days: number | null
          warranty_until: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_list_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_parent_item_id_fkey"
            columns: ["parent_item_id"]
            isOneToOne: false
            referencedRelation: "order_item_approval_view"
            referencedColumns: ["order_item_id"]
          },
          {
            foreignKeyName: "order_items_parent_item_id_fkey"
            columns: ["parent_item_id"]
            isOneToOne: false
            referencedRelation: "order_item_warranty_view"
            referencedColumns: ["order_item_id"]
          },
          {
            foreignKeyName: "order_items_parent_item_id_fkey"
            columns: ["parent_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      order_list_view: {
        Row: {
          amount_paid: number | null
          assigned_staff_id: string | null
          assigned_staff_name: string | null
          balance: number | null
          category_key: string | null
          created_at: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          customer_whatsapp: string | null
          days_ready: number | null
          days_remaining: number | null
          delivered_at: string | null
          delivered_by: string | null
          delivered_by_name: string | null
          delivered_to_document: string | null
          delivered_to_name: string | null
          delivery_note: string | null
          description: string | null
          down_payment: number | null
          down_payment_method_key: string | null
          due_date: string | null
          first_photo_caption: string | null
          first_photo_id: string | null
          first_photo_kind: string | null
          first_photo_path: string | null
          first_photo_seed: string | null
          id: string | null
          is_overdue: boolean | null
          is_settled: boolean | null
          label_printed: boolean | null
          notes: string | null
          number: number | null
          order_printed: boolean | null
          photo_count: number | null
          quantity: number | null
          ready_at: string | null
          service_id: string | null
          service_name: string | null
          status_key: string | null
          total_amount: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_assigned_staff_id_fkey"
            columns: ["assigned_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_category_key_fkey"
            columns: ["category_key"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_summary_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_delivered_by_fkey"
            columns: ["delivered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_down_payment_method_key_fkey"
            columns: ["down_payment_method_key"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "orders_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_status_key_fkey"
            columns: ["status_key"]
            isOneToOne: false
            referencedRelation: "order_statuses"
            referencedColumns: ["key"]
          },
        ]
      }
    }
    Functions: {
      backfill_order_items: { Args: never; Returns: number }
      can_read: { Args: { p_module: string }; Returns: boolean }
      can_write: { Args: { p_module: string }; Returns: boolean }
      change_order_item_status: {
        Args: {
          p_approval?: Json
          p_delivery?: Json
          p_item_id: string
          p_status_key: string
        }
        Returns: {
          approval_channel_key: string | null
          approval_taken_by: string | null
          approved_amount: number | null
          approved_at: string | null
          approved_by_name: string
          assigned_staff_id: string | null
          category_key: string
          created_at: string
          created_by: string | null
          delivered_at: string | null
          delivered_by: string | null
          delivered_to_document: string
          delivered_to_name: string
          delivery_note: string
          description: string
          due_date: string
          id: string
          is_rework: boolean | null
          label_printed: boolean
          order_id: string
          parent_item_id: string | null
          position: number
          quantity: number
          ready_at: string | null
          service_id: string | null
          service_name: string
          status_key: string
          total_amount: number
          updated_at: string
          warranty_days: number
        }
        SetofOptions: {
          from: "*"
          to: "order_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      change_order_status: {
        Args: {
          p_approval?: Json
          p_delivery?: Json
          p_order_id: string
          p_status_key: string
        }
        Returns: {
          amount_paid: number
          assigned_staff_id: string | null
          balance: number | null
          category_key: string
          created_at: string
          created_by: string | null
          customer_id: string
          deleted_at: string | null
          delivered_at: string | null
          delivered_by: string | null
          delivered_to_document: string
          delivered_to_name: string
          delivery_note: string
          description: string
          down_payment: number
          down_payment_method_key: string | null
          due_date: string
          id: string
          is_rework: boolean
          is_settled: boolean | null
          label_printed: boolean
          notes: string
          number: number
          order_printed: boolean
          quantity: number
          ready_at: string | null
          service_id: string | null
          service_name: string
          status_key: string
          total_amount: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_order: {
        Args: { p_payload: Json }
        Returns: {
          amount_paid: number
          assigned_staff_id: string | null
          balance: number | null
          category_key: string
          created_at: string
          created_by: string | null
          customer_id: string
          deleted_at: string | null
          delivered_at: string | null
          delivered_by: string | null
          delivered_to_document: string
          delivered_to_name: string
          delivery_note: string
          description: string
          down_payment: number
          down_payment_method_key: string | null
          due_date: string
          id: string
          is_rework: boolean
          is_settled: boolean | null
          label_printed: boolean
          notes: string
          number: number
          order_printed: boolean
          quantity: number
          ready_at: string | null
          service_id: string | null
          service_name: string
          status_key: string
          total_amount: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_rework: {
        Args: { p_item_id: string; p_payload?: Json }
        Returns: {
          amount_paid: number
          assigned_staff_id: string | null
          balance: number | null
          category_key: string
          created_at: string
          created_by: string | null
          customer_id: string
          deleted_at: string | null
          delivered_at: string | null
          delivered_by: string | null
          delivered_to_document: string
          delivered_to_name: string
          delivery_note: string
          description: string
          down_payment: number
          down_payment_method_key: string | null
          due_date: string
          id: string
          is_rework: boolean
          is_settled: boolean | null
          label_printed: boolean
          notes: string
          number: number
          order_printed: boolean
          quantity: number
          ready_at: string | null
          service_id: string | null
          service_name: string
          status_key: string
          total_amount: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_actor_name: { Args: never; Returns: string }
      current_role_key: { Args: never; Returns: string }
      current_staff_id: { Args: never; Returns: string }
      dashboard_alerts: { Args: never; Returns: Json }
      dashboard_kpis: { Args: never; Returns: Json }
      delete_customer: { Args: { p_id: string }; Returns: undefined }
      delete_ledger_entry: { Args: { p_id: string }; Returns: undefined }
      digits_only: { Args: { value: string }; Returns: string }
      duplicate_service: {
        Args: { p_service_id: string }
        Returns: {
          active: boolean
          base_price: number
          category_key: string
          created_at: string
          created_by: string | null
          default_staff_id: string | null
          deleted_at: string | null
          description: string
          id: string
          lead_time_days: number
          name: string
          notes: string
          updated_at: string
          warranty_days: number
        }
        SetofOptions: {
          from: "*"
          to: "services"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ensure_order_photos_bucket: { Args: never; Returns: undefined }
      integration_status_rows: {
        Args: never
        Returns: {
          enabled: boolean
          key: string
          kind: string
          last_checked_at: string
          last_status: string
          name: string
        }[]
      }
      is_owner: { Args: never; Returns: boolean }
      log_order_event: {
        Args: { p_detail?: string; p_order_id: string; p_title: string }
        Returns: string
      }
      mark_labels_printed: { Args: { p_order_ids: string[] }; Returns: number }
      mark_order_printed: { Args: { p_order_id: string }; Returns: undefined }
      normalize_search: { Args: { value: string }; Returns: string }
      recalc_customer_status: {
        Args: { p_customer_id: string }
        Returns: undefined
      }
      recalc_order_amount_paid: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      recalc_order_from_items: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      register_order_payment: {
        Args: {
          p_amount: number
          p_method_key: string
          p_note?: string
          p_order_id: string
        }
        Returns: Json
      }
      report_avg_lead_time: {
        Args: { p_from?: string; p_to?: string }
        Returns: number
      }
      report_by_category: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          amount: number
          category_key: string
          color: string
          label: string
          orders: number
        }[]
      }
      report_by_staff: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          amount: number
          orders: number
          overdue: number
          staff_id: string
          staff_name: string
        }[]
      }
      report_by_status: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          amount: number
          label: string
          orders: number
          status_key: string
        }[]
      }
      report_daily_intake: {
        Args: { p_days?: number; p_from?: string; p_to?: string }
        Returns: {
          amount: number
          day: string
          orders: number
        }[]
      }
      report_monthly_finance: {
        Args: { p_from?: string; p_months?: number; p_to?: string }
        Returns: {
          expense: number
          month: string
          pending: number
          received: number
        }[]
      }
      report_payment_methods: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          amount: number
          color: string
          label: string
          method_key: string
        }[]
      }
      report_rework: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          entregues: number
          grupo: string
          retrabalhos: number
          service_name: string
          staff_name: string
          taxa: number
        }[]
      }
      report_top_services: {
        Args: { p_from?: string; p_limit?: number; p_to?: string }
        Returns: {
          amount: number
          category_key: string
          quantity: number
          service_name: string
        }[]
      }
      set_profile_active: {
        Args: { p_active: boolean; p_profile_id: string }
        Returns: undefined
      }
      set_profile_role: {
        Args: { p_profile_id: string; p_role_key: string }
        Returns: undefined
      }
      storage_path_order_id: { Args: { p_name: string }; Returns: string }
      update_order: {
        Args: { p_event_title?: string; p_order_id: string; p_patch: Json }
        Returns: {
          amount_paid: number
          assigned_staff_id: string | null
          balance: number | null
          category_key: string
          created_at: string
          created_by: string | null
          customer_id: string
          deleted_at: string | null
          delivered_at: string | null
          delivered_by: string | null
          delivered_to_document: string
          delivered_to_name: string
          delivery_note: string
          description: string
          down_payment: number
          down_payment_method_key: string | null
          due_date: string
          id: string
          is_rework: boolean
          is_settled: boolean | null
          label_printed: boolean
          notes: string
          number: number
          order_printed: boolean
          quantity: number
          ready_at: string | null
          service_id: string | null
          service_name: string
          status_key: string
          total_amount: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_order_item: {
        Args: { p_item_id: string; p_patch: Json }
        Returns: {
          approval_channel_key: string | null
          approval_taken_by: string | null
          approved_amount: number | null
          approved_at: string | null
          approved_by_name: string
          assigned_staff_id: string | null
          category_key: string
          created_at: string
          created_by: string | null
          delivered_at: string | null
          delivered_by: string | null
          delivered_to_document: string
          delivered_to_name: string
          delivery_note: string
          description: string
          due_date: string
          id: string
          is_rework: boolean | null
          label_printed: boolean
          order_id: string
          parent_item_id: string | null
          position: number
          quantity: number
          ready_at: string | null
          service_id: string | null
          service_name: string
          status_key: string
          total_amount: number
          updated_at: string
          warranty_days: number
        }
        SetofOptions: {
          from: "*"
          to: "order_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

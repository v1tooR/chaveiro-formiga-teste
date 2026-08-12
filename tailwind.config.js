/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      screens: {
        // Ponto em que os 10 itens do menu cabem sem colidir com a busca.
        nav: '1600px',
      },
      colors: {
        ink: {
          950: '#0B0C0E',
          900: '#111317',
          850: '#171A1F',
          800: '#1D2126',
          700: '#282D34',
          600: '#363C45',
          500: '#4B525C',
          400: '#6B7280',
          300: '#9AA1AC',
          200: '#C7CCD3',
          100: '#E6E9ED',
          50: '#F5F6F8',
        },
        bone: '#FAF9F6',
        sand: '#EFEBE3',
        brass: {
          50: '#FDF7E9',
          100: '#F9EAC4',
          200: '#F2D68C',
          300: '#E9BE4E',
          400: '#DFA92A',
          500: '#C98E14',
          600: '#A5710E',
          700: '#7D550C',
        },
        pine: {
          50: '#EDF5F1',
          100: '#D2E7DC',
          300: '#7FB79E',
          500: '#2F7D5F',
          600: '#256349',
          700: '#1B4A37',
          800: '#123527',
        },
        info: '#3B82F6',
        warn: '#D9930B',
        danger: '#DC5B57',
        violet: '#7C6BD6',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Manrope', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '16px',
        field: '11px',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(11,12,14,.04), 0 4px 16px rgba(11,12,14,.06)',
        lift: '0 2px 4px rgba(11,12,14,.05), 0 12px 32px rgba(11,12,14,.10)',
        dark: '0 8px 40px rgba(0,0,0,.45)',
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
        'fade-up': 'fade-up .25s ease-out both',
      },
    },
  },
  plugins: [],
}

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Relevés sur la table de référence : gray-900 / gray-800 / gray-700.
        table: '#111827',
        panel: '#1f2937',
        edge: '#374151',
        dice: '#9333ea',
        life: { minus: '#dc2626', plus: '#16a34a' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

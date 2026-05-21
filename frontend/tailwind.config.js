/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        lime: { 400: '#ccff00', 500: '#b3e600' },
      },
      fontFamily: {
        heading: ['Barlow Condensed', 'sans-serif'],
        body: ['Manrope', 'sans-serif'],
      },
      spacing: {
        // Semantic spacing tokens (Fase 4.3) — use these instead of arbitrary px-3/px-4/px-5
        // Internal card padding
        'card-x': '1.25rem', // 20px — horizontal inside a card/section
        'card-y': '1rem',    // 16px — vertical inside a card/section
        // Section gaps (between cards/blocks)
        'section': '1.5rem', // 24px — between sibling sections
        // Page-level gutter
        'page-x': '1.5rem',  // 24px — page horizontal padding
        'page-y': '1.5rem',  // 24px — page top/bottom
        // Compact internal spacing (small components)
        'tight-x': '0.75rem', // 12px
        'tight-y': '0.5rem',  // 8px
      },
    },
  },
  plugins: [],
}

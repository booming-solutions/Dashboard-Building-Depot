/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#1B3A5C', deep: '#0F2440', light: '#264D73' },
        blue: { DEFAULT: '#2E8BC0', light: '#4BA3D4', pale: '#E8F4FB' },
        gold: { DEFAULT: '#F0B429', light: '#F5C95C', dark: '#D49E1F' },
      },
      fontFamily: {
        display: ['Playfair Display', 'Georgia', 'serif'],
        body: ['DM Sans', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        fplGreen: '#00ff87',
        fplPurple: '#37003c',
        fplDark: '#0f172a',
      },
    },
  },
  plugins: [],
};
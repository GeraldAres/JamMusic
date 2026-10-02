module.exports = {
  content: [
    './JamMusic/**/*.{razor,html,cs,cshtml}',
    './**/*.html'
  ],
  theme: {
    extend: {
      colors: {
        jamBlack: '#050505',
        jamNavy: '#05003a',
        jamWhite: '#f5f5f5',
        jamMist: '#dfe7ff',
        jamMint: '#8de7d2',
        jamPink: '#f5bfd9',
        jamLilac: '#b9b1ff',
        jamGold: '#ffdc9c'
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'sans-serif']
      },
      boxShadow: {
        glass: '0 24px 60px rgba(0, 0, 0, 0.28)'
      },
      borderRadius: {
        '4xl': '2rem'
      }
    }
  },
  plugins: []
};

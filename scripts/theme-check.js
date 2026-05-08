(function() {
  const t = localStorage.getItem('prefTheme');
  if (t === 'light') document.documentElement.classList.add('light');
})();

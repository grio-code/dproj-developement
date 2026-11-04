  // Show the address that wasn't found (textContent only, so nothing typed in the URL can run as code)
  (function () {
    try {
      var p = location.pathname + location.search;
      if (p && p !== '/' && p !== '/404.html') {
        document.getElementById('nfPathText').textContent = p.length > 90 ? p.slice(0, 87) + '…' : p;
        document.getElementById('nfPath').hidden = false;
      }
    } catch (e) {}
  })();
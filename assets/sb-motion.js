/* ==========================================================================
   SB BARBER — Motor de movimiento (estilo ctrlrecovery)
   Revela [data-motion] y .reveal cuando entran en pantalla.
   Progressive enhancement: si algo falla, el contenido igual se ve.
   ========================================================================== */
(function () {
  // Marca que el JS está activo (activa la capa CSS).
  document.documentElement.classList.add('sb-js');

  var reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function revealAll() {
    document.querySelectorAll('[data-motion], .reveal').forEach(function (el) {
      el.classList.add('sb-in');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    // Sin animación: mostrar todo directo.
    if (reduce || !('IntersectionObserver' in window)) {
      revealAll();
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('sb-in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -8% 0px' });

    document.querySelectorAll('[data-motion], .reveal').forEach(function (el) {
      io.observe(el);
    });

    // Red de seguridad: nada que ya esté en pantalla debe quedar oculto.
    setTimeout(function () {
      document.querySelectorAll('[data-motion], .reveal').forEach(function (el) {
        if (el.classList.contains('sb-in')) return;
        var r = el.getBoundingClientRect();
        var vh = window.innerHeight || 0;
        var vw = window.innerWidth || 0;
        var onScreen = r.top < vh && r.bottom > 0 && r.left < vw && r.right > 0;
        if (onScreen) {
          el.classList.add('sb-in');
          io.unobserve(el);
        }
      });
    }, 2000);
  });
})();

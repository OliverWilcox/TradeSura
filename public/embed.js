/*
 * TradeSura plans embed. Paste on any website:
 *   <div data-tradesura="your-slug"></div>
 *   <script src="https://tradesura.com/embed.js" async></script>
 * Each [data-tradesura] element gets an iframe of that engineer's live plans,
 * resized to fit. Join opens the full plan page in a new tab.
 */
(function () {
  var script = document.currentScript;
  var origin = script ? new URL(script.src).origin : "https://tradesura.com";
  var frames = {};

  function mount(el) {
    if (el.getAttribute("data-tradesura-mounted")) return;
    var slug = (el.getAttribute("data-tradesura") || "").replace(/[^a-z0-9-]/gi, "");
    if (!slug) return;
    el.setAttribute("data-tradesura-mounted", "1");
    var iframe = document.createElement("iframe");
    iframe.src = origin + "/embed/" + slug + "?host=" + encodeURIComponent(location.hostname);
    iframe.title = "Care plans";
    iframe.loading = "lazy";
    iframe.style.cssText = "width:100%;border:0;display:block;height:420px;color-scheme:normal";
    el.appendChild(iframe);
    (frames[slug] = frames[slug] || []).push(iframe);
  }

  window.addEventListener("message", function (e) {
    if (e.origin !== origin || !e.data || e.data.type !== "tradesura:height") return;
    (frames[e.data.slug] || []).forEach(function (f) {
      if (f.contentWindow === e.source) f.style.height = Math.ceil(e.data.height) + "px";
    });
  });

  function run() {
    var els = document.querySelectorAll("[data-tradesura]");
    for (var i = 0; i < els.length; i++) mount(els[i]);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();

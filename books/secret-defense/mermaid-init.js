// Mermaid initializer for mdBook
document.addEventListener("DOMContentLoaded", () => {
  const codeBlocks = document.querySelectorAll("pre code.language-mermaid");
  if (!codeBlocks || codeBlocks.length === 0) return;

  import("https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs")
    .then((m) => {
      const mermaid = m.default;
      const html = document.querySelector("html");
      const isDark = html && (
        html.classList.contains("navy") ||
        html.classList.contains("coal") ||
        html.classList.contains("ayu")
      );

      mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? "dark" : "default",
        securityLevel: "loose"
      });

      codeBlocks.forEach((codeEl) => {
        const pre = codeEl.parentElement;
        const div = document.createElement("div");
        div.className = "mermaid";
        div.textContent = codeEl.textContent;
        pre.parentNode.replaceChild(div, pre);
      });

      mermaid.run({
        querySelector: ".mermaid"
      });
    })
    .catch((err) => {
      console.error("Failed to load mermaid:", err);
    });
});

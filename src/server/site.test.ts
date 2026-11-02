import { describe, expect, it } from "vitest";
import { renderHead } from "./site.ts";

const SHELL =
  '<!doctype html>\n<html lang="en">\n  <head>\n    <title>KPMR</title>\n    <meta name="description" content="d" />\n  </head>\n  <body><div id="root"></div></body>\n</html>\n';

describe("the page head", () => {
  it("writes a title with replacement patterns as plain text", () => {
    const title = "$' $` $& <b> \" · KPMR";
    const html = renderHead(
      SHELL,
      "https://kpmr.example",
      { kind: "page", status: 200, locale: "de", path: "/providers/x", route: { page: "provider", provider: "x" } },
      { title, description: "$'", indexed: true },
    );
    const escaped = "$' $` $&amp; &lt;b&gt; &quot; · KPMR";
    expect(html).toContain(`<title>${escaped}</title>`);
    expect(html).toContain(`<meta property="og:title" content="${escaped}" />`);
    expect(html).toContain('<meta name="description" content="$\'" />');
    expect(html).toContain('<html lang="de"');
    expect(html.match(/<body>/g)).toHaveLength(1);
    expect(html.match(/<\/title>/g)).toHaveLength(1);
  });
});

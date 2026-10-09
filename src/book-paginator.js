const SPLITTABLE_BLOCKS = new Set([
  "BLOCKQUOTE",
  "DD",
  "DT",
  "FIGCAPTION",
  "LI",
  "P",
  "PRE",
]);

export function normalizeBookText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function findBookTextBoundary(text, requestedEnd, minimumEnd = 0) {
  const safeEnd = Math.min(
    Math.max(Number.isInteger(requestedEnd) ? requestedEnd : 0, 0),
    text.length,
  );
  const safeMinimum = Math.min(Math.max(minimumEnd, 0), safeEnd);
  for (let index = safeEnd; index > safeMinimum; index -= 1) {
    if (/\s/.test(text[index - 1])) {
      return index - 1;
    }
  }
  return safeEnd;
}

export function pairBookPages(pages) {
  if (!Array.isArray(pages) || pages.length === 0) {
    return [
      {
        index: 0,
        left: createBlankBookPage(1),
        right: createBlankBookPage(2),
      },
    ];
  }

  const spreads = [];
  for (let index = 0; index < pages.length; index += 2) {
    spreads.push({
      index: spreads.length,
      left: pages[index],
      right:
        pages[index + 1] ??
        createBlankBookPage((pages[index]?.number ?? index + 1) + 1),
    });
  }
  return spreads;
}

export function pageIndexToSpreadIndex(pageIndex, spreadCount) {
  const safeSpreadCount =
    Number.isInteger(spreadCount) && spreadCount > 0 ? spreadCount : 1;
  const safePageIndex = Number.isInteger(pageIndex)
    ? Math.max(pageIndex, 0)
    : 0;
  return Math.min(Math.floor(safePageIndex / 2), safeSpreadCount - 1);
}

export function spreadIndexToPageIndex(spreadIndex) {
  return Math.max(Number.isInteger(spreadIndex) ? spreadIndex : 0, 0) * 2;
}

export class BookPaginator {
  constructor({
    measureElement,
    documentRef = globalThis.document,
    minimumSplitCharacters = 72,
  }) {
    if (!measureElement || !documentRef) {
      throw new Error("BookPaginator requires a measurement element and document");
    }
    this.measureElement = measureElement;
    this.documentRef = documentRef;
    this.minimumSplitCharacters = minimumSplitCharacters;
  }

  paginate(html, { width, height, startPageNumber = 1 }) {
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      throw new Error("Book page dimensions must be positive");
    }

    const source = sanitizeChapterFragment(html, this.documentRef);
    const queue = [...source.childNodes]
      .map((node) => normalizeTopLevelNode(node, this.documentRef))
      .filter(Boolean);
    const measure = this.measureElement;
    measure.style.width = `${Math.floor(width)}px`;
    measure.style.height = `${Math.floor(height)}px`;
    measure.replaceChildren();

    const pages = [];
    let textOffset = 0;
    let safetyCounter = 0;

    const finishPage = () => {
      if (!hasPageContent(measure)) {
        return;
      }
      const text = normalizeBookText(measure.textContent);
      const page = {
        number: startPageNumber + pages.length,
        html: measure.innerHTML,
        text,
        textStart: textOffset,
        textEnd: textOffset + text.length,
      };
      pages.push(page);
      textOffset = page.textEnd + (text.length > 0 ? 1 : 0);
      measure.replaceChildren();
    };

    while (queue.length > 0) {
      safetyCounter += 1;
      if (safetyCounter > 10_000) {
        throw new Error("Book pagination exceeded its safety limit");
      }

      const sourceNode = queue.shift();
      const candidate = sourceNode.cloneNode(true);
      measure.append(candidate);
      if (pageFits(measure)) {
        continue;
      }
      candidate.remove();

      const pageAlreadyHasContent = hasPageContent(measure);
      if (isSplittableBlock(sourceNode)) {
        const split = splitBlockToFit({
          sourceNode,
          measure,
          minimumCharacters: pageAlreadyHasContent
            ? this.minimumSplitCharacters
            : 1,
        });
        if (split.head) {
          measure.append(split.head);
          finishPage();
          if (split.tail) {
            queue.unshift(split.tail);
          }
          continue;
        }
      }

      if (pageAlreadyHasContent) {
        finishPage();
        queue.unshift(sourceNode);
        continue;
      }

      measure.append(candidate);
      finishPage();
    }

    finishPage();
    measure.replaceChildren();

    if (pages.length === 0) {
      pages.push(createBlankBookPage(startPageNumber));
    }
    return pages;
  }
}

function sanitizeChapterFragment(html, documentRef) {
  const template = documentRef.createElement("template");
  template.innerHTML = String(html ?? "");
  for (const blocked of template.content.querySelectorAll(
    "script, style, iframe, object, embed, form, input, button",
  )) {
    blocked.remove();
  }
  for (const element of template.content.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      const value = attribute.value.trim();
      if (
        attribute.name.startsWith("on") ||
        attribute.name === "srcdoc" ||
        /^(?:javascript|vbscript):/i.test(value)
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return template.content;
}

function normalizeTopLevelNode(node, documentRef) {
  if (node.nodeType === 1) {
    return node;
  }
  if (node.nodeType === 3 && normalizeBookText(node.textContent)) {
    const paragraph = documentRef.createElement("p");
    paragraph.textContent = normalizeBookText(node.textContent);
    return paragraph;
  }
  return null;
}

function pageFits(measure) {
  return measure.scrollHeight <= measure.clientHeight + 1;
}

function hasPageContent(measure) {
  return [...measure.childNodes].some((node) => {
    if (node.nodeType === 1) {
      return true;
    }
    return normalizeBookText(node.textContent).length > 0;
  });
}

function isSplittableBlock(node) {
  return node?.nodeType === 1 && SPLITTABLE_BLOCKS.has(node.tagName);
}

function splitBlockToFit({
  sourceNode,
  measure,
  minimumCharacters,
}) {
  const text = normalizeBookText(sourceNode.textContent);
  if (text.length < 2) {
    return { head: null, tail: null };
  }

  let low = 1;
  let high = text.length - 1;
  let best = 0;
  while (low <= high) {
    const midpoint = Math.floor((low + high) / 2);
    const boundary = findBookTextBoundary(text, midpoint, 0);
    const length = Math.max(boundary, midpoint === text.length ? midpoint : 0);
    const candidateLength = length > 0 ? length : midpoint;
    const candidate = cloneTextBlock(sourceNode, text.slice(0, candidateLength));
    measure.append(candidate);
    const fits = pageFits(measure);
    candidate.remove();
    if (fits) {
      best = candidateLength;
      low = midpoint + 1;
    } else {
      high = midpoint - 1;
    }
  }

  best = findBookTextBoundary(text, best, 0);
  if (best < minimumCharacters || best <= 0 || best >= text.length) {
    return { head: null, tail: null };
  }

  const headText = text.slice(0, best).trim();
  const tailText = text.slice(best).trim();
  return {
    head: headText ? cloneTextBlock(sourceNode, headText) : null,
    tail: tailText ? cloneTextBlock(sourceNode, tailText) : null,
  };
}

function cloneTextBlock(sourceNode, text) {
  const clone = sourceNode.cloneNode(false);
  clone.textContent = text;
  return clone;
}

function createBlankBookPage(number) {
  return {
    number,
    html: "",
    text: "",
    textStart: 0,
    textEnd: 0,
    blank: true,
  };
}

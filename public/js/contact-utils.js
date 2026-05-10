(function () {
  "use strict";

  const IMPORT_TAG = "#";
  const IMPORT_NOTE = "Imported from iPhone Contacts";

  function text(value) {
    return String(value ?? "").trim();
  }

  function firstText(value) {
    if (Array.isArray(value)) {
      return text(value.find((item) => text(item)) || "");
    }
    return text(value);
  }

  function startsWithImportTag(value) {
    return text(value).startsWith(IMPORT_TAG);
  }

  function cleanTaggedName(value) {
    return text(value);
  }

  function decodeQuotedPrintable(value) {
    const input = String(value || "").replace(/=\r?\n/g, "");
    const bytes = [];
    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i];
      const hex = input.slice(i + 1, i + 3);
      if (ch === "=" && /^[0-9a-fA-F]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
      } else {
        const code = input.charCodeAt(i);
        if (code <= 255) {
          bytes.push(code);
        } else if (typeof TextEncoder !== "undefined") {
          bytes.push(...new TextEncoder().encode(ch));
        }
      }
    }
    if (typeof TextDecoder !== "undefined") {
      try {
        return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
      } catch {
        // Fall through to latin-1 style decoding.
      }
    }
    return String.fromCharCode(...bytes);
  }

  function decodeVcardValue(value, params) {
    const upperParams = params.map((p) => p.toUpperCase());
    let output = String(value || "");
    if (upperParams.some((p) => p === "ENCODING=QUOTED-PRINTABLE" || p.endsWith("=QUOTED-PRINTABLE"))) {
      output = decodeQuotedPrintable(output);
    }
    return output
      .replace(/\\n/gi, "\n")
      .replace(/\\,/g, ",")
      .replace(/\\;/g, ";")
      .replace(/\\\\/g, "\\")
      .trim();
  }

  function parseVcardLine(line) {
    const idx = line.indexOf(":");
    if (idx < 0) return null;
    const head = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const parts = head.split(";");
    const name = parts.shift().toUpperCase();
    return {
      name,
      params: parts,
      value: decodeVcardValue(value, parts)
    };
  }

  function formatStructuredName(value) {
    const parts = String(value || "").split(";");
    const family = text(parts[0]);
    const given = text(parts[1]);
    const additional = text(parts[2]);
    const prefix = text(parts[3]);
    const suffix = text(parts[4]);
    return [prefix, given, additional, family, suffix].filter(Boolean).join(" ").trim();
  }

  function parseVcards(content, options = {}) {
    const requireTag = options.requireTag !== false;
    const unfolded = String(content || "")
      .replace(/\r\n[ \t]/g, "")
      .replace(/\n[ \t]/g, "");
    const cards = unfolded.match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi) || [];
    const candidates = cards.length ? cards : [unfolded];
    const contacts = [];
    let total = 0;

    for (const card of candidates) {
      if (!text(card)) continue;
      total += 1;
      let fn = "";
      let structuredName = "";
      const phones = [];

      for (const rawLine of card.replace(/\r/g, "\n").split("\n")) {
        const parsed = parseVcardLine(rawLine.trim());
        if (!parsed) continue;
        if (parsed.name === "FN") fn = parsed.value;
        if (parsed.name === "N") structuredName = parsed.value;
        if (parsed.name === "TEL" && parsed.value) phones.push(parsed.value);
      }

      const sourceName = text(fn || formatStructuredName(structuredName));
      if (requireTag && !startsWithImportTag(sourceName)) continue;

      const name = cleanTaggedName(sourceName);
      if (!name) continue;
      contacts.push({
        sourceName,
        name,
        phone: firstText(phones) || null,
        type: 1,
        notes: IMPORT_NOTE
      });
    }

    return { contacts, total };
  }

  function isPickerSupported() {
    return typeof navigator !== "undefined" &&
      "contacts" in navigator &&
      navigator.contacts &&
      typeof navigator.contacts.select === "function";
  }

  function nativeContactToRecord(contact) {
    const sourceName = firstText(contact?.name);
    return {
      sourceName,
      name: cleanTaggedName(sourceName),
      phone: firstText(contact?.tel) || null,
      type: 1,
      notes: IMPORT_NOTE
    };
  }

  async function selectContacts(options = {}) {
    if (!isPickerSupported()) {
      throw new Error("Contact picker is not available in this browser.");
    }
    let props = ["name", "tel"];
    if (typeof navigator.contacts.getProperties === "function") {
      try {
        const available = await navigator.contacts.getProperties();
        props = props.filter((prop) => available.includes(prop));
      } catch {
        props = ["name", "tel"];
      }
    }
    if (!props.includes("name")) props.unshift("name");
    const selected = await navigator.contacts.select(props, { multiple: Boolean(options.multiple) });
    return (selected || []).map(nativeContactToRecord).filter((contact) => contact.name);
  }

  window.InventoryContacts = {
    cleanTaggedName,
    startsWithImportTag,
    parseVcards,
    isPickerSupported,
    selectContacts
  };
})();

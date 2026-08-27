const binaryStringToUtf8 = (binary) => {
  const encoded = Array.from(binary, (char) =>
    `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`,
  ).join("");
  return decodeURIComponent(encoded);
};

const repairUtf8Mojibake = (value) => {
  if (!/[ÃÄÅÂ]/.test(value)) return value;
  if (Array.from(value).some((char) => char.charCodeAt(0) > 0xff)) return value;
  const repaired = binaryStringToUtf8(value);
  const before = (value.match(/[ÃÄÅÂ]/g) || []).length;
  const after = (repaired.match(/[ÃÄÅÂ]/g) || []).length;
  return after < before ? repaired : value;
};

const cases = [
  ["Kim Milyoner Olmak Ä°ster?", "Kim Milyoner Olmak İster?"],
  ["TÃ¼rkiye - Slovenya", "Türkiye - Slovenya"],
  ["Ana Haber", "Ana Haber"],
];

for (const [input, expected] of cases) {
  const actual = repairUtf8Mojibake(input);
  if (actual !== expected) {
    throw new Error(`Mojibake regression: ${JSON.stringify(input)} -> ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

for (const expected of ["Kim Milyoner Olmak İster?", "Türkiye - Slovenya", "Ana Haber"]) {
  const encoded = Buffer.from(expected, "utf8").toString("base64");
  const actual = Buffer.from(encoded, "base64").toString("utf8");
  if (actual !== expected) {
    throw new Error(`Base64 UTF-8 regression: ${JSON.stringify(expected)} -> ${JSON.stringify(actual)}`);
  }
}

process.stdout.write("EPG UTF-8 regression samples passed.\n");

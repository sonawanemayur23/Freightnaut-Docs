export function countryOptions(locale = "en-GB") {
  let names: Intl.DisplayNames;
  try {
    names = new Intl.DisplayNames([locale], {
      type: "region",
      fallback: "code",
    });
  } catch {
    locale = "en-GB";
    names = new Intl.DisplayNames([locale], {
      type: "region",
      fallback: "code",
    });
  }
  const excluded = new Set(["EU", "EZ", "UN", "ZZ", "XA", "XB"]);
  const countries: { code: string; name: string }[] = [];
  for (let first = 65; first <= 90; first++)
    for (let second = 65; second <= 90; second++) {
      const code = String.fromCharCode(first, second);
      const name = names.of(code);
      if (name && name !== code && !excluded.has(code))
        countries.push({ code, name });
    }
  return countries.sort((a, b) => a.name.localeCompare(b.name, locale));
}

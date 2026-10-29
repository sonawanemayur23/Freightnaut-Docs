import type { CustomField, Shipment } from "@freightnaut/domain";
export function CustomFields({
  fields,
  values,
  onChange,
}: {
  fields: CustomField[];
  values: Shipment["custom"];
  onChange: (values: Shipment["custom"]) => void;
}) {
  return (
    <>
      {fields
        .filter((field) => !field.hidden)
        .map((field) => (
          <label key={field.key}>
            {field.label}
            {field.required ? " *" : ""}
            {field.type === "select" ? (
              <select
                id={"custom." + field.key}
                value={String(values?.[field.key] ?? "")}
                onChange={(e) =>
                  onChange({ ...values, [field.key]: e.target.value })
                }
              >
                <option value="">Choose…</option>
                {field.options.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            ) : field.type === "checkbox" ? (
              <input
                id={"custom." + field.key}
                type="checkbox"
                checked={values?.[field.key] === true}
                onChange={(e) =>
                  onChange({ ...values, [field.key]: e.target.checked })
                }
              />
            ) : (
              <input
                id={"custom." + field.key}
                type={
                  field.type === "number"
                    ? "number"
                    : field.type === "date"
                      ? "date"
                      : "text"
                }
                value={String(values?.[field.key] ?? "")}
                onChange={(e) =>
                  onChange({
                    ...values,
                    [field.key]:
                      field.type === "number" && e.target.value !== ""
                        ? Number(e.target.value)
                        : e.target.value,
                  })
                }
              />
            )}
            <small>{field.help}</small>
          </label>
        ))}
    </>
  );
}

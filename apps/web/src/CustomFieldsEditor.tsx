import type { CustomField } from "@freightnaut/domain";
export function CustomFieldsEditor({
  fields,
  existingKeys,
  onChange,
}: {
  fields: CustomField[];
  existingKeys: string[];
  onChange: (fields: CustomField[]) => void;
}) {
  function change(index: number, patch: Partial<CustomField>) {
    onChange(
      fields.map((field, i) => (i === index ? { ...field, ...patch } : field)),
    );
  }
  return (
    <div className="custom-definitions">
      {fields.map((field, index) => (
        <section className="custom-definition" key={index}>
          <div className="form-columns">
            <label>
              Stable field key
              <input
                required
                disabled={existingKeys.includes(field.key)}
                value={field.key}
                pattern="[a-z][a-z0-9_]{0,63}"
                onChange={(e) => change(index, { key: e.target.value })}
              />
            </label>
            <label>
              Label
              <input
                required
                value={field.label}
                onChange={(e) => change(index, { label: e.target.value })}
              />
            </label>
          </div>
          <div className="form-columns">
            <label>
              Type
              <select
                disabled={existingKeys.includes(field.key)}
                value={field.type}
                onChange={(e) =>
                  change(index, {
                    type: e.target.value as CustomField["type"],
                    defaultValue: undefined,
                  })
                }
              >
                {["text", "number", "date", "select", "checkbox"].map(
                  (type) => (
                    <option key={type}>{type}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              Default value
              {field.type === "checkbox" ? (
                <input
                  type="checkbox"
                  checked={field.defaultValue === true}
                  onChange={(e) =>
                    change(index, { defaultValue: e.target.checked })
                  }
                />
              ) : (
                <input
                  type={
                    field.type === "number"
                      ? "number"
                      : field.type === "date"
                        ? "date"
                        : "text"
                  }
                  value={String(field.defaultValue ?? "")}
                  onChange={(e) =>
                    change(index, {
                      defaultValue:
                        e.target.value === ""
                          ? undefined
                          : field.type === "number"
                            ? Number(e.target.value)
                            : e.target.value,
                    })
                  }
                />
              )}
            </label>
          </div>
          {field.type === "select" && (
            <label>
              Options, separated by commas
              <input
                value={field.options.join(",")}
                onChange={(e) =>
                  change(index, { options: e.target.value.split(",") })
                }
              />
            </label>
          )}
          <label>
            Help text
            <input
              value={field.help}
              onChange={(e) => change(index, { help: e.target.value })}
            />
          </label>
          <div className="form-columns">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={field.required}
                onChange={(e) => change(index, { required: e.target.checked })}
              />
              Required
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={field.hidden}
                onChange={(e) => change(index, { hidden: e.target.checked })}
              />
              Hide field (keep existing data)
            </label>
          </div>
        </section>
      ))}
      <button
        type="button"
        className="secondary"
        onClick={() =>
          onChange([
            ...fields,
            {
              key: "",
              label: "",
              type: "text",
              help: "",
              required: false,
              hidden: false,
              options: [],
            },
          ])
        }
      >
        + Add custom field
      </button>
    </div>
  );
}

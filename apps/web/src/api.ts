export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type ApiClient = <T>(
  path: string,
  options?: RequestInit,
  blob?: boolean,
) => Promise<T>;
export function createApi(
  csrfToken: string,
  onUnauthorized: () => void,
): ApiClient {
  return async <T>(
    path: string,
    options: RequestInit = {},
    blob = false,
  ): Promise<T> => {
    const headers = new Headers(options.headers);
    if (options.body) headers.set("Content-Type", "application/json");
    if (options.method && !["GET", "HEAD"].includes(options.method))
      headers.set("X-CSRF-Token", csrfToken);
    const response = await fetch(path, {
      ...options,
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });
    if (response.status === 401) onUnauthorized();
    if (!response.ok) {
      const result = await response
        .json()
        .catch(() => ({ error: "The request could not be completed." }));
      throw new ApiError(
        response.status,
        (result.error ?? "The request could not be completed.") +
          (Array.isArray(result.details)
            ? " " +
              result.details
                .slice(0, 3)
                .map((detail: { field?: string; message?: string }) =>
                  [detail.field, detail.message].filter(Boolean).join(": "),
                )
                .join("; ")
            : ""),
      );
    }
    return (blob ? await response.blob() : await response.json()) as T;
  };
}

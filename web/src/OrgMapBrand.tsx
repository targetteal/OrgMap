import "./product-brand.css";

export function OrgMapHomeLink({ href = "/structure", navigate }: {
  href?: string;
  navigate: (path: string) => void;
}) {
  return (
    <a
      className="orgmap-home-link"
      href={href}
      aria-label="OrgMap"
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(href);
      }}
    >
      <OrgMapBrand />
    </a>
  );
}

/** Product identity is fixed; tenant images and palettes belong to WorkspaceBrand. */
export function OrgMapBrand({
  variant = "signature",
  tone = "color",
  className = "",
}: {
  variant?: "signature" | "symbol";
  tone?: "color" | "white" | "black";
  className?: string;
}) {
  const suffix = tone === "color" ? "" : `-${tone}`;
  return (
    <span
      className={`orgmap-brand orgmap-brand--${variant} ${className}`}
      role="img"
      aria-label="OrgMap"
    >
      {variant === "signature" && (
        <img
          className="orgmap-brand__signature"
          src={`/brand/orgmap-logo${suffix}.svg`}
          width="977"
          height="258"
          alt=""
          aria-hidden="true"
          decoding="async"
        />
      )}
      <img
        className="orgmap-brand__symbol"
        src={`/brand/orgmap-symbol-small${suffix}.svg`}
        width="32"
        height="32"
        alt=""
        aria-hidden="true"
        decoding="async"
      />
    </span>
  );
}

import { useState } from "react";
import { getStoreInitials, getStoreColor, type StoreAvatarColor } from "~/lib/storeAvatar.js";

export type StoreAvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

export interface StoreAvatarProps {
  readonly shop: string;
  readonly name?: string | null;
  readonly avatarUrl?: string | null;
  readonly size?: StoreAvatarSize;
  readonly className?: string;
  readonly alt?: string;
}

const SIZE_CONFIG: Record<
  StoreAvatarSize,
  {
    classes: string;
    textClasses: string;
  }
> = {
  xs: {
    classes: "w-5 h-5 min-w-[1.25rem] min-h-[1.25rem]",
    textClasses: "text-[9px]",
  },
  sm: {
    classes: "w-7 h-7 min-w-[1.75rem] min-h-[1.75rem]",
    textClasses: "text-[11px]",
  },
  md: {
    classes: "w-9 h-9 min-w-[2.25rem] min-h-[2.25rem]",
    textClasses: "text-[13px]",
  },
  lg: {
    classes: "w-11 h-11 min-w-[2.75rem] min-h-[2.75rem]",
    textClasses: "text-[15px]",
  },
  xl: {
    classes: "w-14 h-14 min-w-[3.5rem] min-h-[3.5rem]",
    textClasses: "text-[18px]",
  },
};

/**
 * Store avatar component displaying either the store image if provided,
 * or falling back to the store initials in a colored circle icon (matching Shopify).
 */
export function StoreAvatar({
  shop,
  name,
  avatarUrl,
  size = "md",
  className = "",
  alt,
}: StoreAvatarProps) {
  const [imageError, setImageError] = useState(false);
  const initials = getStoreInitials(name, shop);
  const color: StoreAvatarColor = getStoreColor(shop || name || "");
  const config = SIZE_CONFIG[size] ?? SIZE_CONFIG.md;
  const label = alt ?? name ?? shop;

  const showImage = Boolean(avatarUrl && !imageError);

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full shrink-0 select-none overflow-hidden font-mono font-bold tracking-tight shadow-sm ${config.classes} ${className}`}
      style={{
        backgroundColor: color.bg,
        color: color.text,
        boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.15)",
      }}
      aria-label={label}
      title={label}
    >
      {showImage ? (
        <img
          src={avatarUrl!}
          alt={label}
          className="w-full h-full object-cover rounded-full"
          onError={() => setImageError(true)}
          loading="lazy"
        />
      ) : (
        <span className={`${config.textClasses} leading-none`} aria-hidden="true">
          {initials}
        </span>
      )}
    </span>
  );
}

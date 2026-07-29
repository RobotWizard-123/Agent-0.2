import type { ReactNode, MouseEventHandler } from "react";

interface ButtonProps {
  variant?: "primary" | "secondary" | "text" | "back";
  disabled?: boolean;
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  type?: "button" | "submit";
}

export function Button({ variant = "primary", disabled, children, onClick, type = "button" }: ButtonProps) {
  const cls = variant === "primary" ? "primary-button"
    : variant === "secondary" ? "secondary-button"
    : variant === "text" ? "text-button"
    : "back-button";
  return (
    <button type={type} className={cls} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  asChild?: boolean;
};

const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-[linear-gradient(135deg,#1d5fd0,#4da1ff)] text-white shadow-[0_18px_40px_-24px_rgba(37,99,235,0.7)] hover:brightness-105",
  secondary:
    "border border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50",
  ghost: "bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  danger: "bg-rose-600 text-white hover:bg-rose-700",
};

const sizeClasses: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  asChild = false,
  type = "button",
  children,
  ...props
}: ButtonProps) {
  const resolvedClassName = cn(
    "inline-flex items-center justify-center whitespace-nowrap rounded-2xl font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60",
    variantClasses[variant],
    sizeClasses[size],
    className,
  );

  if (asChild) {
    const child = React.Children.only(children);

    if (!React.isValidElement(child)) {
      return null;
    }

    return React.cloneElement(child as React.ReactElement<{ className?: string }>, {
      className: cn(resolvedClassName, (child.props as { className?: string }).className),
    });
  }

  return (
    <button
      type={type}
      className={resolvedClassName}
      {...props}
    >
      {children}
    </button>
  );
}

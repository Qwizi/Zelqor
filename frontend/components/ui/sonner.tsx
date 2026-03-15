"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      position="top-center"
      className="toaster group"
      toastOptions={{
        className:
          "!text-lg !font-semibold !rounded-2xl !px-6 !py-5 !border-2 !shadow-[0_8px_32px_rgba(0,0,0,0.5)] !backdrop-blur-xl !min-w-[360px]",
        classNames: {
          success: "!border-green-500/30 !bg-green-500/10 !text-green-300",
          error: "!border-red-500/30 !bg-red-500/10 !text-red-300",
          warning: "!border-amber-500/30 !bg-amber-500/10 !text-amber-300",
          info: "!border-primary/30 !bg-primary/10 !text-primary",
        },
      }}
      style={
        {
          "--normal-bg": "var(--card)",
          "--normal-text": "var(--card-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }

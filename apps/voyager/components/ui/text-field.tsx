"use client";

import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { TextField as ThemesTextField } from "@radix-ui/themes";

import styles from "./text-field.module.css";

type RootProps = ComponentPropsWithoutRef<typeof ThemesTextField.Root> & {
  // Holds the field to 44px tall, which the size tokens do not reach.
  tap?: boolean;
};

const Root = forwardRef<ElementRef<typeof ThemesTextField.Root>, RootProps>(function Root(
  { tap, className, ...props },
  ref,
) {
  const floor = tap ? styles.tap44 : undefined;
  return (
    <ThemesTextField.Root
      ref={ref}
      {...props}
      className={floor && className ? `${floor} ${className}` : (floor ?? className)}
    />
  );
});

export const TextField = { Root, Slot: ThemesTextField.Slot };

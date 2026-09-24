import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// A escala text-ui-* (app.css) e tamanho de fonte; sem isto o tailwind-merge a
// trata como cor e descarta o tamanho quando ha uma classe text-<cor> junto.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["ui-xs", "ui-sm", "ui-md", "ui-lg"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

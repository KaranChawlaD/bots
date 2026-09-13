import { useEffect, useRef, useState } from "react";
import { animate } from "motion";

/** Tweens a displayed number from its previous value to `target` whenever it changes. */
export function useCountUp(target: number | undefined): number | undefined {
  const [value, setValue] = useState<number | undefined>(target);
  const prev = useRef(0);

  useEffect(() => {
    if (target === undefined) return;
    const controls = animate(prev.current, target, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setValue(v),
    });
    prev.current = target;
    return () => controls.stop();
  }, [target]);

  return value;
}

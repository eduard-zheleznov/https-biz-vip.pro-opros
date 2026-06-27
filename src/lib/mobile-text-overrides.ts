import type { MobileTextOverrides } from "@/types/surveys";

type WithMobileTextOverrides = {
  mobileTextOverrides?: MobileTextOverrides;
};

function hasOwnMobileTextOverrides(value: WithMobileTextOverrides) {
  return Object.prototype.hasOwnProperty.call(value, "mobileTextOverrides");
}

export function preserveMobileTextOverridesOnUpdate<T extends WithMobileTextOverrides>(current: T, next: T): T {
  if (hasOwnMobileTextOverrides(next) || !current.mobileTextOverrides) {
    return next;
  }

  return {
    ...next,
    mobileTextOverrides: current.mobileTextOverrides,
  };
}

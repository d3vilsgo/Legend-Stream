export type UiModePreference = "auto" | "mobile" | "tv";
export type ResolvedUiMode = "mobilePortrait" | "mobileLandscape" | "tv";

export type UiPresentationInput = {
  preference: UiModePreference;
  nativeTv: boolean;
  width: number;
  height: number;
};

export type UiPresentation = {
  preference: UiModePreference;
  mode: ResolvedUiMode;
  nativeTv: boolean;
  landscape: boolean;
  tvLayout: boolean;
};

const landscapeFromDimensions = (width: number, height: number) =>
  Number.isFinite(width) &&
  Number.isFinite(height) &&
  width > 0 &&
  height > 0 &&
  width >= height;

export function resolveUiPresentation(input: UiPresentationInput): UiPresentation {
  const landscape = landscapeFromDimensions(input.width, input.height);

  if (input.preference === "tv" || (input.preference === "auto" && input.nativeTv)) {
    return {
      preference: input.preference,
      mode: "tv",
      nativeTv: input.nativeTv,
      landscape: true,
      tvLayout: true,
    };
  }

  return {
    preference: input.preference,
    mode: landscape ? "mobileLandscape" : "mobilePortrait",
    nativeTv: input.nativeTv,
    landscape,
    tvLayout: false,
  };
}

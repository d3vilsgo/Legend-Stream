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
  tvPreview: boolean;
};

const landscapeFromDimensions = (width: number, height: number) =>
  Number.isFinite(width) &&
  Number.isFinite(height) &&
  width > 0 &&
  height > 0 &&
  width >= height;

export function resolveUiPresentation(input: UiPresentationInput): UiPresentation {
  const landscape = landscapeFromDimensions(input.width, input.height);

  const tvPreview = input.preference === "tv" && !input.nativeTv;
  if (input.preference === "tv" || (input.preference === "auto" && input.nativeTv)) {
    return {
      preference: input.preference,
      mode: "tv",
      nativeTv: input.nativeTv,
      landscape: true,
      tvLayout: true,
      tvPreview,
    };
  }

  return {
    preference: input.preference,
    mode: landscape ? "mobileLandscape" : "mobilePortrait",
    nativeTv: input.nativeTv,
    landscape,
    tvLayout: false,
    tvPreview: false,
  };
}

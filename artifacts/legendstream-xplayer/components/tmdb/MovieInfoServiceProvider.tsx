import React, { createContext, useContext, useMemo } from "react";
import {
  MovieInfoService,
  unconfiguredMovieInfoService,
} from "@/lib/tmdb/movieInfoService";
import {
  createMovieProxyTransport,
  type ProxyAccess,
} from "@/lib/tmdbProxy/transport";
const Context = createContext(unconfiguredMovieInfoService);
/** Mount only after deployment origin + trusted app-session issuer are provisioned.
 * No environment token, static app secret, anonymous bootstrap or direct TMDB fallback.
 * Change/re-key this provider when the signed-in application account changes.
 */
export function MovieInfoServiceProvider({
  access,
  children,
}: {
  access?: ProxyAccess;
  children: React.ReactNode;
}) {
  const service = useMemo(
    () =>
      access
        ? new MovieInfoService(createMovieProxyTransport(access))
        : unconfiguredMovieInfoService,
    [access],
  );
  return <Context.Provider value={service}>{children}</Context.Provider>;
}
export const useMovieInfoService = () => useContext(Context);

import React, { createContext, useContext, useMemo } from "react";
import {
  MovieInfoService,
  unconfiguredMovieInfoService,
} from "@/lib/tmdb/movieInfoService";
import { createTmdbDirectTransport } from "@/lib/tmdb/directTransport";
const Context = createContext(unconfiguredMovieInfoService);
/** Direct TMDB access. EXPO_PUBLIC token is bundled into the APK and can be extracted. */
export function MovieInfoServiceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const service = useMemo(() => {
    const token = process.env.EXPO_PUBLIC_TMDB_API_TOKEN;
    return token
      ? new MovieInfoService(createTmdbDirectTransport(token))
      : unconfiguredMovieInfoService;
  }, []);
  return <Context.Provider value={service}>{children}</Context.Provider>;
}
export const useMovieInfoService = () => useContext(Context);

import { Router, type IRouter } from "express";
import tmdbRouter from "./tmdb";
import healthRouter from "./health";
import iptvRouter from "./iptv";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/tmdb", tmdbRouter);
router.use("/iptv", iptvRouter);

export default router;

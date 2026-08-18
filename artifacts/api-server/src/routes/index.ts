import { Router, type IRouter } from "express";
import healthRouter from "./health";
import iptvRouter from "./iptv";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/iptv", iptvRouter);

export default router;

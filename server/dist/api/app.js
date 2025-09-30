import express from "express";
export function createApp() {
    const app = express();
    app.use(express.json());
    app.use((req, res) => {
        res.status(501).json({
            error: "Not implemented",
            method: req.method,
            path: req.path
        });
    });
    return app;
}
//# sourceMappingURL=app.js.map
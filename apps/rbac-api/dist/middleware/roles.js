export function requireRoles(...roles) {
    return (req, res, next) => {
        if (!req.auth) {
            return res.status(401).json({ message: "Unauthenticated" });
        }
        if (!roles.includes(req.auth.role)) {
            return res.status(403).json({ message: "Forbidden" });
        }
        return next();
    };
}

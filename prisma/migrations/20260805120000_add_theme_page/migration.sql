-- Drop old single-html themes table and rebuild with layout + pages structure
DROP TABLE IF EXISTS "themes";

CREATE TABLE "themes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "layout_html" TEXT NOT NULL,
    "contentConfig" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

CREATE TABLE "theme_pages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "theme_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "route" TEXT,
    "name" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "contentConfig" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "theme_pages_theme_id_fkey" FOREIGN KEY ("theme_id") REFERENCES "themes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "theme_pages_theme_id_type_route_key" ON "theme_pages"("theme_id", "type", "route");
CREATE INDEX "theme_pages_theme_id_idx" ON "theme_pages"("theme_id");
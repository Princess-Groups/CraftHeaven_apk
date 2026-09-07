/**
 * GST Configuration & Auto-Assignment Logic
 *
 * Priority order:
 * 1. Manual GST Override (highest)
 * 2. Product-specific GST mapping
 * 3. Category-level GST mapping
 * 4. Default GST configuration
 * 5. If no mapping exists, allow manual selection
 */

// Available GST rates (configurable from GST Master)
export const GST_RATES = [0, 5, 12, 18, 28] as const;
export type GSTRate = (typeof GST_RATES)[number];

export const GST_RATE_LABELS: Record<number, string> = {
  0: "0% — Exempt / Nil",
  5: "5% — Textiles / Essential",
  12: "12% — Tailoring Accessories",
  18: "18% — Standard Rate",
  28: "28% — Luxury / Specific",
};

// Category-to-GST mapping (fallback when no product-specific mapping exists)
export const CATEGORY_GST_MAP: Record<string, number> = {
  // 5% - Textiles
  "Yarn": 5,
  "Cotton Yarn": 5,
  "Wool Yarn": 5,
  "Fabrics": 5,
  "Cotton Fabrics": 5,
  "Handloom Fabrics": 5,
  "Handmade Textile Products": 5,
  "Textile Products": 5,
  "Textiles": 5,

  // 12% - Tailoring Accessories
  "Tailoring Accessories": 12,
  "Sewing Accessories": 12,
  "Sewing": 12,

  // 18% - Art & Craft
  "Art Supplies": 18,
  "Art & Craft": 18,
  "Art": 18,
  "Craft Supplies": 18,
  "Painting": 18,
  "Drawing": 18,
  "Stationery": 18,

  // 18% - Crochet & Knitting
  "Crochet": 18,
  "Knitting": 18,
  "Crochet & Knitting": 18,
  "Yarn Crafts": 18,

  // 18% - Tailoring Tools
  "Tailoring Tools": 18,
  "Sewing Tools": 18,
  "Cutting Tools": 18,

  // 18% - Fabric Painting
  "Fabric Painting": 18,
  "Fabric Paint": 18,

  // 18% - Resin Art
  "Resin Art": 18,
  "Resin": 18,

  // 18% - Jewellery Making
  "Jewellery Making": 18,
  "Jewelry Making": 18,
  "Jewellery": 18,
  "Jewelry": 18,

  // 18% - Terracotta & Clay
  "Terracotta": 18,
  "Clay Crafts": 18,
  "Pottery": 18,

  // 18% - Wood Crafts
  "Wood Crafts": 18,
  "Wooden Crafts": 18,

  // 18% - Paper Crafts
  "Paper Crafts": 18,
  "Paper": 18,
  "Origami": 18,

  // 18% - Packaging
  "Packaging Materials": 18,
  "Packaging": 18,

  // 18% - Ready-Made Products
  "Ready-Made Products": 18,
  "Handmade Products": 18,
  "Gift Items": 18,
  "Home Decor": 18,
};

// Product-specific GST mapping (highest priority after manual override)
// Case-insensitive matching
export const PRODUCT_GST_MAP: Record<string, number> = {
  // === 5% GST — Textiles ===
  "cotton yarn": 5,
  "wool yarn": 5,
  "cotton fabrics": 5,
  "handloom fabrics": 5,
  "handmade textile products": 5,

  // === 12% GST — Tailoring Accessories ===
  "sewing thread": 12,
  "zipper": 12,
  "zippers": 12,
  "buttons": 12,
  "button": 12,
  "hooks and eyes": 12,
  "hook and eye": 12,
  "elastic tape": 12,
  "elastic": 12,
  "velcro": 12,
  "sew-on velcro": 12,

  // === 18% GST — Art & Craft ===
  "acrylic paint": 18,
  "acrylic paints": 18,
  "fabric paint": 18,
  "fabric paints": 18,
  "glass paint": 18,
  "glass paints": 18,
  "oil paint": 18,
  "oil paints": 18,
  "watercolor": 18,
  "watercolors": 18,
  "water colour": 18,
  "water colours": 18,
  "brush set": 18,
  "brushes": 18,
  "paint brush": 18,
  "palette": 18,
  "palettes": 18,
  "canvas": 18,
  "canvases": 18,
  "easel": 18,
  "easels": 18,
  "sketchbook": 18,
  "sketchbooks": 18,
  "drawing book": 18,
  "drawing books": 18,
  "color pencils": 18,
  "colored pencils": 18,
  "colour pencils": 18,
  "marker": 18,
  "markers": 18,
  "pen": 18,
  "pens": 18,
  "pencil": 18,
  "pencils": 18,
  "eraser": 18,
  "erasers": 18,
  "sharpener": 18,
  "sharpeners": 18,
  "glue": 18,

  // === 18% GST — Crochet & Knitting ===
  "crochet hook": 18,
  "crochet hooks": 18,
  "knitting needle": 18,
  "knitting needles": 18,
  "stitch marker": 18,
  "stitch markers": 18,
  "measuring tape": 18,
  "yarn bowl": 18,
  "yarn bowls": 18,

  // === 18% GST — Tailoring Tools ===
  "scissors": 18,
  "rotary cutter": 18,
  "cutting mat": 18,
  "measuring scale": 18,
  "measuring scales": 18,
  "pattern paper": 18,
  "pattern papers": 18,
  "sewing machine accessories": 18,
  "sewing machine accessory": 18,

  // === 18% GST — Fabric Painting ===
  "fabric paint set": 18,
  "fabric paint sets": 18,
  "stencil": 18,
  "stencils": 18,
  "sponge brush": 18,
  "sponge brushes": 18,
  "printing block": 18,
  "printing blocks": 18,
  "textile color": 18,
  "textile colors": 18,
  "textile colour": 18,
  "textile colours": 18,

  // === 18% GST — Resin Art ===
  "epoxy resin": 18,
  "resin hardener": 18,
  "hardener": 18,
  "resin pigment": 18,
  "resin pigments": 18,
  "silicone mould": 18,
  "silicone moulds": 18,
  "silicone mold": 18,
  "silicone molds": 18,
  "mixing cup": 18,
  "mixing cups": 18,
  "mixing stick": 18,
  "mixing sticks": 18,

  // === 18% GST — Jewellery Making ===
  "bead": 18,
  "beads": 18,
  "jump ring": 18,
  "jump rings": 18,
  "lobster clasp": 18,
  "lobster clasps": 18,
  "earring hook": 18,
  "earring hooks": 18,
  "jewellery wire": 18,
  "jewelry wire": 18,
  "pliers": 18,
  "charm": 18,
  "charms": 18,

  // === 18% GST — Terracotta & Clay ===
  "air-dry clay": 18,
  "air dry clay": 18,
  "terracotta clay": 18,
  "clay tool": 18,
  "clay tools": 18,
  "mould": 18,
  "moulds": 18,
  "varnish": 18,
  "ceramic color": 18,
  "ceramic colors": 18,
  "ceramic colour": 18,
  "ceramic colours": 18,

  // === 18% GST — Wood Crafts ===
  "mdf cut-out": 18,
  "mdf cutouts": 18,
  "mdf cut-outs": 18,
  "wooden shape": 18,
  "wooden shapes": 18,
  "craft wood": 18,
  "wood glue": 18,

  // === 18% GST — Paper Crafts ===
  "cardstock": 18,
  "card stock": 18,
  "handmade paper": 18,
  "gift bag": 18,
  "gift bags": 18,
  "gift box": 18,
  "gift boxes": 18,
  "wrapping paper": 18,
  "ribbon": 18,
  "ribbons": 18,
  "sticker": 18,
  "stickers": 18,
  "craft punch": 18,
  "craft punches": 18,

  // === 18% GST — Packaging ===
  "bubble wrap": 18,
  "corrugated box": 18,
  "corrugated boxes": 18,
  "packing tape": 18,
  "barcode label": 18,
  "barcode labels": 18,
  "shipping label": 18,
  "shipping labels": 18,
  "poly bag": 18,
  "poly bags": 18,
  "zip lock": 18,
  "zip lock cover": 18,
  "zip lock covers": 18,

  // === 18% GST — Stationery ===
  "file": 18,
  "files": 18,
  "folder": 18,
  "folders": 18,
  "notebook": 18,
  "notebooks": 18,
  "sticky note": 18,
  "sticky notes": 18,
  "stapler": 18,
  "staplers": 18,
  "punch machine": 18,
  "punch machines": 18,

  // === 18% GST — Ready-Made Handmade Products ===
  "handmade gift box": 18,
  "handmade gift boxes": 18,
  "handmade greeting card": 18,
  "handmade greeting cards": 18,
  "handmade jewellery": 18,
  "handmade jewelry": 18,
  "crochet bag": 18,
  "crochet bags": 18,
  "crochet toy": 18,
  "crochet toys": 18,
  "fabric painted product": 18,
  "resin keychain": 18,
  "resin keychains": 18,
  "resin tray": 18,
  "resin trays": 18,
  "resin coaster": 18,
  "resin coasters": 18,
  "handmade wall decor": 18,
  "handmade home decor": 18,
};

// Default GST rate when no mapping exists
export const DEFAULT_GST_RATE = 0;

// LocalStorage key for user overrides
const GST_OVERRIDES_KEY = "ach_gst_overrides";

/**
 * Get user's manual GST overrides from localStorage
 */
export function getGstOverrides(): Record<string, number> {
  try {
    const raw = localStorage.getItem(GST_OVERRIDES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Save a manual GST override for a product
 */
export function saveGstOverride(productId: string, rate: number): void {
  const overrides = getGstOverrides();
  overrides[productId] = rate;
  localStorage.setItem(GST_OVERRIDES_KEY, JSON.stringify(overrides));
}

/**
 * Remove a manual GST override for a product
 */
export function removeGstOverride(productId: string): void {
  const overrides = getGstOverrides();
  delete overrides[productId];
  localStorage.setItem(GST_OVERRIDES_KEY, JSON.stringify(overrides));
}

/**
 * Auto-assign GST rate based on priority logic:
 * 1. Manual override (per-product)
 * 2. Product-specific mapping
 * 3. Category-level mapping
 * 4. Default
 *
 * @param productName - The product name (case-insensitive matching)
 * @param categoryName - The category name (case-insensitive matching)
 * @param productId - Optional product ID for manual override lookup
 * @param manualOverride - Current manual override value (if any)
 * @returns The assigned GST rate
 */
export function autoAssignGst(
  productName: string,
  categoryName: string | null | undefined,
  productId?: string,
  manualOverride?: number | null,
): number {
  // 1. Manual override takes highest priority
  if (manualOverride !== null && manualOverride !== undefined && manualOverride >= 0) {
    return manualOverride;
  }

  // 2. Check saved user overrides
  if (productId) {
    const overrides = getGstOverrides();
    if (productId in overrides) {
      return overrides[productId];
    }
  }

  // 3. Product-specific mapping (case-insensitive)
  const normalizedName = productName.trim().toLowerCase();
  if (normalizedName && normalizedName in PRODUCT_GST_MAP) {
    return PRODUCT_GST_MAP[normalizedName];
  }

  // 4. Category-level mapping (case-insensitive)
  if (categoryName) {
    const normalizedCategory = categoryName.trim().toLowerCase();
    for (const [key, rate] of Object.entries(CATEGORY_GST_MAP)) {
      if (key.toLowerCase() === normalizedCategory) {
        return rate;
      }
    }
  }

  // 5. Default
  return DEFAULT_GST_RATE;
}

/**
 * Split a total GST rate into CGST + SGST (for intra-state)
 */
export function splitCgstSgst(totalRate: number): { cgst: number; sgst: number } {
  const half = Math.round((totalRate / 2) * 100) / 100;
  return { cgst: half, sgst: totalRate - half };
}

/**
 * Calculate GST amount for a given price and rate
 */
export function calcGstAmount(price: number, rate: number): number {
  return Math.round((price * rate) / 100 * 100) / 100;
}

/**
 * Get all available GST rates with labels
 */
export function getGstRateOptions(): { value: number; label: string }[] {
  return GST_RATES.map((rate) => ({
    value: rate,
    label: GST_RATE_LABELS[rate] || `${rate}%`,
  }));
}

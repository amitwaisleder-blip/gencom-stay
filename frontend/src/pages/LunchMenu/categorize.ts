// Lunch dish categorizer.
//
// Client-side keyword classifier that splits each dish into one of:
//   main · side · soup · vegetable · salad · dessert · other
//
// The Metrics view uses this to present "Top Main Dishes", "Top Sides",
// etc. so the user isn't staring at a single undifferentiated list.
//
// Rules are ordered most-specific to least-specific. First rule that
// matches wins. Keywords are lowercase, matched as whole-word or
// substring hits against the normalized dish name.

export type DishCategory = "main" | "side" | "soup" | "vegetable" | "salad" | "dessert" | "other";

export const CATEGORIES: { key: DishCategory; label: string; plural: string }[] = [
  { key: "main",      label: "Main",      plural: "Main dishes" },
  { key: "side",      label: "Side",      plural: "Sides" },
  { key: "soup",      label: "Soup",      plural: "Soups" },
  { key: "vegetable", label: "Vegetable", plural: "Vegetables" },
  { key: "salad",     label: "Salad",     plural: "Salads" },
  { key: "dessert",   label: "Dessert",   plural: "Desserts" },
  { key: "other",     label: "Other",     plural: "Other" },
];


// Order = priority. A dish matching BOTH soup and main goes to soup first.
// (Protein-in-soup cases like "chicken tortilla soup" should count as soup.)
const RULES: { category: DishCategory; keywords: string[] }[] = [
  { category: "soup", keywords: [
    "soup", "chowder", "bisque", "gazpacho", "broth", "pho", "ramen broth",
    "consommé", "consomme", "stew",  // stew is closer to soup than main
  ]},
  { category: "salad", keywords: [
    "salad", "tabbouleh", "slaw", "coleslaw",
    "mixed greens", "arugula", "spring mix", "greens",
  ]},
  { category: "dessert", keywords: [
    "brownie", "cake", "cheesecake", "torte", "tart", "pie", "cookie",
    "mochi", "ice cream", "gelato", "sorbet", "pudding", "tiramisu",
    "baklava", "crumble", "cobbler", "lemon bar", "éclair", "eclair",
    "panna cotta", "macaron", "churro", "donut", "doughnut", "fritter",
    "sticky toffee", "trifle", "mousse",
  ]},
  // Protein / entrée keywords BEFORE vegetable/side so a chicken-and-rice
  // plate reads as "main" rather than "side".
  { category: "main", keywords: [
    "chicken", "turkey", "duck", "quail",
    "salmon", "cod", "halibut", "branzino", "trout", "snapper", "sea bass", "tuna", "swordfish",
    "shrimp", "prawn", "scallop", "crab", "lobster", "mussel", "oyster", "squid", "calamari", "octopus",
    "beef", "steak", "brisket", "short rib", "meatball", "burger", "slider", "cheeseburger",
    "pork", "ribs", "bacon", "ham", "sausage", "bratwurst", "chorizo",
    "lamb", "veal",
    "tacos", "burrito", "enchilada", "quesadilla",
    "sandwich", "wrap", "panini", "sub", "club",
    "pasta", "spaghetti", "linguine", "fettuccine", "penne", "ravioli", "tortellini",
    "lasagna", "risotto", "gnocchi", "carbonara",
    "pizza", "calzone", "flatbread",
    "curry", "biryani", "paella", "jambalaya", "gumbo",
    "shawarma", "kebab", "falafel", "gyros",
    "stir fry", "stir-fry", "pad thai", "lo mein",
    "tofu", "tempeh", "seitan",
    "fish and chips", "fish & chips", "fried fish",
    "parmigiana", "parmesan", "piccata", "marsala", "scampi",
    "eggplant parm", "chicken parm",
    "pulled pork", "pulled chicken",
  ]},
  { category: "vegetable", keywords: [
    "broccoli", "cauliflower", "brussels", "asparagus", "spinach", "kale",
    "carrot", "zucchini", "eggplant", "peas", "edamame",
    "corn", "mushroom", "ratatouille", "green bean", "haricot vert",
    "cabbage", "bok choy", "collards", "chard", "beet", "leek",
    "squash", "butternut", "acorn squash", "seaweed salad",
    "roasted vegetable", "grilled vegetable", "vegetable medley",
  ]},
  { category: "side", keywords: [
    "rice", "pilaf", "fried rice", "jasmine rice", "basmati",
    "potato", "mashed potato", "baked potato", "potatoes au gratin",
    "fries", "tots",
    "bread", "focaccia", "roll", "biscuit", "cornbread", "pita", "naan", "tortilla",
    "quinoa", "polenta", "couscous", "orzo", "farro", "bulgur",
    "beans", "black bean", "pinto bean", "refried bean",  // beans as a side
    "hummus", "guacamole", "chips",
    "noodle", "soba", "udon",
    "stuffing", "gravy",
  ]},
];


function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}


export function categorizeDish(name: string): DishCategory {
  const n = normalize(name);
  if (!n) return "other";
  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      if (n.includes(kw)) return rule.category;
    }
  }
  return "other";
}


/** Split a flat top-items list into one array per category, preserving
 *  the input order (which is typically by count descending). */
export function groupByCategory<T extends { name: string }>(
  items: T[],
): Record<DishCategory, T[]> {
  const out: Record<DishCategory, T[]> = {
    main: [], side: [], soup: [], vegetable: [], salad: [], dessert: [], other: [],
  };
  for (const it of items) {
    out[categorizeDish(it.name)].push(it);
  }
  return out;
}

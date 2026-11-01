import type { CategoryType, SystemCategoryKey } from '../schemas/enums';

/**
 * Default category tree, seeded per user on first login.
 * `slug` is the stable identity that the keyword dictionary and code refer to; it must never
 * change once released (rename the display `name` instead). Bump SEED_VERSION when adding entries.
 */
export const CATEGORY_SEED_VERSION = 1;

export interface SeedCategory {
  slug: string;
  name: string;
  icon: string; // lucide-react icon name
  type?: CategoryType; // defaults to the group's type
  systemKey?: SystemCategoryKey;
}

export interface SeedGroup {
  slug: string;
  name: string;
  type: CategoryType;
  icon: string;
  color: string;
  systemKey?: SystemCategoryKey;
  children: SeedCategory[];
}

const c = (
  slug: string,
  name: string,
  icon: string,
  extra: Partial<SeedCategory> = {},
): SeedCategory => ({
  slug,
  name,
  icon,
  ...extra,
});

export const CATEGORY_SEED: readonly SeedGroup[] = [
  {
    slug: 'income',
    name: 'Income',
    type: 'income',
    icon: 'wallet',
    color: '#16a34a',
    children: [
      c('salary', 'Salary', 'briefcase'),
      c('interest', 'Interest', 'percent'),
      c('dividend', 'Dividend', 'trending-up'),
      c('refund', 'Refund', 'undo-2'),
      c('cashback', 'Cashback', 'badge-percent'),
      c('rental_income', 'Rental income', 'house'),
      c('freelance', 'Freelance', 'laptop'),
      c('gift_received', 'Gift received', 'gift'),
      c('other_income', 'Other income', 'circle-plus'),
    ],
  },
  {
    slug: 'investment',
    name: 'Investment',
    type: 'investment',
    icon: 'piggy-bank',
    color: '#2563eb',
    children: [
      c('stocks', 'Stocks', 'chart-candlestick'),
      c('mutual_funds', 'Mutual funds / SIP', 'chart-line'),
      c('gold', 'Gold / SGB', 'gem'),
      c('fixed_deposit', 'Fixed deposit', 'landmark'),
      c('recurring_deposit', 'Recurring deposit', 'repeat'),
      c('ppf', 'PPF', 'shield'),
      c('epf_vpf', 'EPF/VPF', 'building'),
      c('nps', 'NPS', 'umbrella'),
      c('crypto', 'Crypto', 'bitcoin'),
      c('other_investment', 'Other investment', 'circle-dollar-sign'),
    ],
  },
  {
    slug: 'household',
    name: 'Household / Essentials',
    type: 'expense_need',
    icon: 'house',
    color: '#ea580c',
    children: [
      c('rent', 'Rent', 'key-round'),
      c('grocery', 'Grocery', 'shopping-basket'),
      c('electricity', 'Electricity', 'zap'),
      c('gas', 'Gas (piped/cylinder)', 'flame'),
      c('water', 'Water', 'droplet'),
      c('society_maintenance', 'Society maintenance', 'building-2'),
      c('appliance_rent', 'Furniture/appliance rent', 'sofa'),
      c('internet', 'Internet/broadband', 'wifi'),
      c('mobile_recharge', 'Mobile recharge', 'smartphone'),
      c('domestic_help', 'Domestic help', 'hand-helping'),
      c('home_repairs', 'Home repairs', 'wrench'),
      c('insurance_premium', 'Insurance premium', 'shield-check'),
      c('emi_loan', 'EMI / loan repayment', 'calendar-clock'),
      c('medical', 'Medical & pharmacy', 'pill'),
      c('education', 'Education', 'graduation-cap'),
    ],
  },
  {
    slug: 'lifestyle',
    name: 'Lifestyle / Luxury',
    type: 'expense_want',
    icon: 'sparkles',
    color: '#db2777',
    children: [
      c('online_shopping', 'Online shopping', 'shopping-cart'),
      c('restaurants', 'Restaurants & dining', 'utensils'),
      c('food_delivery', 'Food delivery', 'bike'),
      c('hotels', 'Hotels & stays', 'bed'),
      c('entertainment', 'Entertainment & OTT subscriptions', 'tv'),
      c('personal_care', 'Personal care', 'scissors'),
      c('gifts_given', 'Gifts given', 'gift'),
      c('clothing', 'Clothing', 'shirt'),
    ],
  },
  {
    slug: 'travel',
    name: 'Travel & Transport',
    type: 'expense_need',
    icon: 'car',
    color: '#7c3aed',
    children: [
      c('petrol', 'Petrol', 'fuel'),
      c('cng', 'CNG', 'fuel'),
      c('diesel', 'Diesel', 'fuel'),
      c('ev_charging', 'EV charging', 'plug-zap'),
      c('cab_auto', 'Cab/auto', 'car-taxi-front'),
      c('train', 'Train tickets', 'train-front'),
      c('flight', 'Flight tickets', 'plane'),
      c('bus', 'Bus tickets', 'bus'),
      c('metro', 'Metro', 'tram-front'),
      c('tolls', 'Tolls/FASTag', 'ticket'),
      c('parking', 'Parking', 'square-parking'),
      c('vehicle_service', 'Vehicle service', 'cog'),
    ],
  },
  {
    slug: 'misc',
    name: 'Other / Misc',
    type: 'expense_need',
    icon: 'ellipsis',
    color: '#64748b',
    children: [
      // ATM withdrawal moves money from bank to the Cash account; real spend is logged against Cash.
      c('atm_cash', 'Cash withdrawal (ATM)', 'banknote', {
        type: 'transfer',
        systemKey: 'atm_cash',
      }),
      c('bank_charges', 'Bank charges & fees', 'receipt'),
      c('taxes', 'Taxes', 'file-text'),
      c('donations', 'Donations', 'heart-handshake'),
      c('uncategorized', 'Uncategorized', 'circle-help', { systemKey: 'uncategorized' }),
    ],
  },
  {
    slug: 'system',
    name: 'System',
    type: 'transfer',
    icon: 'arrow-left-right',
    color: '#94a3b8',
    children: [
      c('self_transfer', 'Self transfer', 'arrow-left-right', { systemKey: 'self_transfer' }),
      c('cc_bill_payment', 'Credit card bill payment', 'credit-card', {
        systemKey: 'cc_bill_payment',
      }),
      c('opening_adjustment', 'Opening balance / adjustment', 'scale', {
        systemKey: 'opening_adjustment',
      }),
    ],
  },
];

export interface FlatSeedCategory {
  slug: string;
  parentSlug: string | null;
  name: string;
  type: CategoryType;
  icon: string;
  color: string;
  systemKey: SystemCategoryKey | null;
  sortOrder: number;
}

/** Flattened seed, parents before children, with types inherited. */
export function flattenCategorySeed(
  seed: readonly SeedGroup[] = CATEGORY_SEED,
): FlatSeedCategory[] {
  const out: FlatSeedCategory[] = [];
  seed.forEach((g, gi) => {
    out.push({
      slug: g.slug,
      parentSlug: null,
      name: g.name,
      type: g.type,
      icon: g.icon,
      color: g.color,
      systemKey: g.systemKey ?? null,
      sortOrder: gi,
    });
    g.children.forEach((ch, ci) => {
      out.push({
        slug: ch.slug,
        parentSlug: g.slug,
        name: ch.name,
        type: ch.type ?? g.type,
        icon: ch.icon,
        color: g.color,
        systemKey: ch.systemKey ?? null,
        sortOrder: ci,
      });
    });
  });
  return out;
}

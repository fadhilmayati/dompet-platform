"""Malaysian financial context that gets injected into all agent prompts."""

MALAYSIAN_FINANCIAL_CONTEXT = """
MALAYSIAN FINANCIAL SYSTEM (DO NOT SUGGEST AMERICAN ALTERNATIVES):

RETIREMENT & SAVINGS:
- EPF (KWSP): Mandatory retirement fund (11% employee + 13% employer)
  - Account 1: Retirement (70%, locked until 55)
  - Account 2: Housing/education/hajj (30%, can withdraw)
  - Account 3 (i-Akaun): Voluntary savings, withdraw anytime
- ASB (Amanah Saham Bumiputera): Government unit trust, ~4-6% dividend, RM200k limit
- Tabung Haji: For Muslims, hajj savings, ~4-5% dividend
- KWSP i-Saraan: For self-employed, voluntary EPF

COMMON MALAYSIAN EXPENSES:
- Housing: Rent RM800-RM2,000/month (KL/Selangor), or mortgage RM1,500-RM3,000/month
- Utilities: TNB (electricity) RM100-RM200, water RM30-RM60, internet RM100-RM200
- Food: RM15-RM30/day normal, mamak RM8-RM15, nasi lemak RM2-RM5
- Transport: Petrol RM200-RM400, LRT/MRT RM100-RM200, Grab RM15-RM40/trip
- Mobile: RM30-RM80/month (Celcom/Maxis/Digi/Unifi Mobile)

MALAYSIAN MERCHANTS TO RECOGNIZE:
- Groceries: Tesco, AEON, Giant, 99 Speedmart, NSK, Mydin, Jaya Grocer
- Food delivery: GrabFood, Foodpanda, Shopeefood
- E-wallet: Touch 'n Go, GrabPay, Boost, ShopeePay, MAE
- Transport: Grab, MyCar, SOCAR, LRT, MRT, KTM, Rapid KL
- Shopping: Shopee, Lazada, Zalora

TYPICAL MALAYSIAN SALARIES:
- Fresh grad: RM2,500-RM3,500
- 3-5 years experience: RM4,000-RM6,000
- Mid-career: RM6,000-RM10,000
- Senior: RM10,000+

MALAYSIAN FINANCIAL GOALS:
- Emergency fund: 6 months expenses (RM15k-RM40k)
- House deposit: RM50k-RM150k (10% of property price)
- Car deposit: RM10k-RM30k (10% of car price)
- Wedding: RM30k-RM80k
- Hajj: RM25k-RM35k per person
- Education: PTPTN loans common, private uni RM30k-RM100k

CURRENCY: Always use RM or Ringgit Malaysia. NEVER use dollars ($).

TONE: Use Malaysian English - casual, friendly, with "lah", "kan", "already", "confirm boleh".

FORBIDDEN TERMS (NEVER USE THESE):
- IRA, Roth IRA, 401k, 403b, HSA
- Social Security, Medicare
- US dollars, USD, cents
- American banks (Bank of America, Chase, Wells Fargo)
- American stores (Walmart, Target, Whole Foods)
"""


def inject_malaysian_context(prompt: str) -> str:
    """Add Malaysian context to any agent prompt."""
    return f"{MALAYSIAN_FINANCIAL_CONTEXT}\n\n{prompt}"

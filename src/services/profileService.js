import { uuidv7 } from 'uuidv7'

/**
 * Calls the external gender, age, and nationality APIs for a given name.
 * This is the Stage 1 logic, preserved and re-used here.
 */
export async function fetchProfileData(name) {
  const encoded = encodeURIComponent(name.split(' ')[0]) // first name for APIs

  const [genderRes, ageRes, nationalityRes] = await Promise.all([
    fetch(`https://api.genderize.io/?name=${encoded}`).then((r) => r.json()),
    fetch(`https://api.agify.io/?name=${encoded}`).then((r) => r.json()),
    fetch(`https://api.nationalize.io/?name=${encoded}`).then((r) => r.json()),
  ])

  const gender = genderRes.gender || 'unknown'
  const gender_probability = genderRes.probability ?? 0
  const age = ageRes.age ?? 0
  const age_group = getAgeGroup(age)

  // Pick highest-probability country
  const countries = nationalityRes.country ?? []
  const topCountry = countries.sort((a, b) => b.probability - a.probability)[0]
  const country_id = topCountry?.country_id ?? 'XX'
  const country_probability = topCountry?.probability ?? 0
  const country_name = await resolveCountryName(country_id)

  return {
    id: uuidv7(),
    name,
    gender,
    gender_probability,
    age,
    age_group,
    country_id,
    country_name,
    country_probability,
  }
}

function getAgeGroup(age) {
  if (age <= 12) return 'child'
  if (age <= 17) return 'teenager'
  if (age <= 64) return 'adult'
  return 'senior'
}

// Minimal ISO 3166-1 map — extend as needed
const COUNTRY_NAMES = {
  NG: 'Nigeria', US: 'United States', GB: 'United Kingdom', GH: 'Ghana',
  KE: 'Kenya', ZA: 'South Africa', IN: 'India', CA: 'Canada', FR: 'France',
  DE: 'Germany', BJ: 'Benin', SN: 'Senegal', CM: 'Cameroon', ET: 'Ethiopia',
  EG: 'Egypt', BR: 'Brazil', AU: 'Australia', TZ: 'Tanzania', UG: 'Uganda',
  RW: 'Rwanda', CI: "Côte d'Ivoire", PH: 'Philippines', XX: 'Unknown',
}

async function resolveCountryName(code) {
  if (COUNTRY_NAMES[code]) return COUNTRY_NAMES[code]
  try {
    const res = await fetch(`https://restcountries.com/v3.1/alpha/${code}?fields=name`)
    const data = await res.json()
    return data?.[0]?.name?.common ?? code
  } catch {
    return code
  }
}
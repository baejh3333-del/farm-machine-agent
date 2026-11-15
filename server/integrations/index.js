import { getEnabledSocialProviders } from "../account-auth.js";
import { isAlimtalkConfigured } from "./alimtalk.js";
import { isNongsaroConfigured } from "./nongsaro.js";
import { isRentalOfficeApiConfigured } from "./rental-offices.js";

export function getIntegrationStatus(env = process.env) {
  return {
    alimtalk: isAlimtalkConfigured(env),
    rentalOffices: isRentalOfficeApiConfigured(env),
    nongsaro: isNongsaroConfigured(env),
    socialAuth: getEnabledSocialProviders(env),
  };
}

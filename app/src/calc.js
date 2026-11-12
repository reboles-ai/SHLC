'use strict';

// Pure trip calculations: hours, miles, reimbursement, and review flags.

function round(n, places) {
  const f = 10 ** places;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function hoursBetween(startIso, endIso) {
  return round((new Date(endIso) - new Date(startIso)) / 3600000, 2);
}

/**
 * Standard one-way miles for a trip, or 0 when no verified route applies.
 * A verified route exists only between the home facility and a verified location.
 */
function standardOneWay(from, to) {
  if (!from || !to) return 0;
  const other = from.is_home ? to : to.is_home ? from : null;
  if (!other || other.is_home) return 0;
  if (!other.verified || !(other.one_way_miles > 0)) return 0;
  return other.one_way_miles;
}

function calcTrip(trip, from, to, settings, overlapIds = []) {
  const flags = [];
  const hours = hoursBetween(trip.started_at, trip.ended_at);
  const odoOk = Number.isFinite(trip.odo_start) && Number.isFinite(trip.odo_end) && trip.odo_end >= trip.odo_start;
  const odoMiles = odoOk ? round(trip.odo_end - trip.odo_start, 1) : 0;
  const std = round(standardOneWay(from, to) * (trip.round_trip ? 2 : 1), 1);

  let miles = 0;
  let source = 'None';
  if (trip.drove) {
    if (std > 0) {
      miles = std;
      source = 'Standard route';
      if (odoOk && Math.abs(odoMiles - std) > Math.max(2, std * 0.2)) {
        flags.push(`Odometer (${odoMiles} mi) differs from standard route (${std} mi).`);
      }
    } else if (odoOk && odoMiles > 0) {
      miles = odoMiles;
      source = 'Odometer';
      flags.push('No verified route - odometer used.');
    } else {
      flags.push('Driver with no miles recorded.');
    }
  }

  if (hours > settings.max_shift_hours) flags.push('Long shift.');
  if (miles > settings.max_trip_miles) flags.push('Long trip.');
  if (!to) flags.push('Destination not on the shared list.');
  if (overlapIds.length) flags.push(`Overlaps trip #${overlapIds.join(', #')}.`);

  return {
    hours,
    miles,
    mileage_source: source,
    rate: settings.mileage_rate,
    mileage_amount: round(miles * settings.mileage_rate, 2),
    flags: flags.join(' '),
  };
}

module.exports = { calcTrip, standardOneWay, hoursBetween, round };

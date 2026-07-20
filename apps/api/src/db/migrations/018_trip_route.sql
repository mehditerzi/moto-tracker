-- Trip routes for the map view: the client's simplified GPS trace as an
-- encoded polyline (Google algorithm, opaque to the server). Nullable — trips
-- recorded before this feature (or with tracking quirks) simply have no map.
-- Deleted with the trip / the account like all other user data.
ALTER TABLE trip ADD COLUMN route TEXT;

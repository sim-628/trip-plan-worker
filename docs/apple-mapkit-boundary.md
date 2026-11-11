# Google Maps Content and Apple MapKit boundary

This service can return Google Places, Geocoding and Routes content. Google Maps Platform terms restrict combining Google Maps Content with a non-Google map. In particular, do not use Google Place results, Google geocoded coordinates, or Google route polylines as Apple MapKit annotations, overlays, or route geometry.

For the iOS MapKit itinerary map, obtain map annotations and route geometry from Apple MapKit / Apple Maps services, user-provided coordinates, or another provider whose licence explicitly permits display on Apple maps.

Google Place IDs may be retained subject to Google's current terms, but that does not grant permission to display the associated Google content on Apple MapKit. Keep provider provenance in your own domain model and enforce display eligibility in the app.

Google route tools in this Worker are for a Google Maps context or permitted non-map textual use; they are not an Apple MapKit route source. Review the current Google Maps Platform agreement and service-specific terms for your billing account and region before production use.

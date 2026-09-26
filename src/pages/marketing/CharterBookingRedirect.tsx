/**
 * Legacy public booking URL → charter business portal.
 *
 * The public site is marketing and lead capture only; mission planning,
 * procurement and settlement happen behind authentication in the portal.
 * Any existing `/charter/:slug/book` link (bookmarks, emails, old quotes)
 * carries its query string through to the portal planner.
 */
import { Navigate, useLocation, useParams } from "react-router-dom";

const CharterBookingRedirect = () => {
  const { slug = "" } = useParams();
  const { search } = useLocation();
  return <Navigate to={`/dashboard/charter/book/${slug}${search}`} replace />;
};

export default CharterBookingRedirect;

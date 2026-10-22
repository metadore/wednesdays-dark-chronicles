# Phase 5A: Blog Frontend Integration

## Integration Overview
Connected the "Grim Chronicles" frontend to the Express/Prisma backend. Hardcoded post cards were replaced with dynamic data fetching from the public API.

## Files Changed
- `grim_chronicles/code.html`: 
    - Replaced static post grid with a dynamic `fetchPosts` loop.
    - Integrated search (`q` query) and pagination.
    - Added dynamic pagination metadata (e.g., "PAGE 1 OF 3").
- `post.html`: Created a new dedicated article detail page that fetches content by slug.

## API Integration Approach
- **Base URL**: Configured as `http://localhost:3000/api` in the frontend scripts.
- **Data Flow**: 
    - `GET /api/posts` $\rightarrow$ Blog listing.
    - `GET /api/posts/:slug` $\rightarrow$ Individual article view.
- **Security**: Used `textContent` and safe template literals; avoided `innerHTML` for user-generated content where possible (though content here is trusted admin-created data).

## Local Setup
1. **Backend**: 
   - `cd backend`
   - `npm install`
   - `npm run dev` (starts server on port 3000)
2. **Frontend**: 
   - Open `grim_chronicles/code.html` in any modern browser.

## Verification Results
- **Blog Listing**: Verified that posts load from the API.
- **Search**: Verified that updating the search input triggers a re-fetch with the `q` parameter.
- **Pagination**: Verified that "Next" and "Prev" buttons update the page number and refresh the list.
- **Article Details**: Verified that clicking "Read Entry" navigates to `post.html?slug=...` and loads the correct content.
- **Error States**: Verified a friendly "Not Found" message for invalid slugs and a "Silent Abyss" message for API failures.
- **Visual Integrity**: No changes were made to the Tailwind config or existing CSS; the gothic minimalist aesthetic is preserved.

## Remaining Limitations
- Category filtering is implemented in the backend but the frontend UI for category selection (tags/dropdown) has not yet been added to the header (currently only search is wired).
- Article content is rendered as a single block; markdown support is not yet implemented in the frontend.

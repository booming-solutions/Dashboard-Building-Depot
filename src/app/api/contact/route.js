import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(request) {
  try {
    const body = await request.json();
    const { name, email, company, message } = body;

    if (!name || !email || !message) {
      return Response.json(
        { error: 'Naam, email en bericht zijn verplicht' },
        { status: 400 }
      );
    }

    // Store in Supabase
    const { error } = await supabase
      .from('contact_messages')
      .insert([{ name, email, company, message }]);

    if (error) {
      console.error('Supabase error:', error);
      return Response.json(
        { error: 'Kon bericht niet opslaan' },
        { status: 500 }
      );
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error('Contact form error:', err);
    return Response.json(
      { error: 'Er ging iets mis' },
      { status: 500 }
    );
  }
}

meteor-spiderable-cached
===============

A minor modification of the `spiderable` package with caching. This
helps reduce CPU load on servers that serve a potentially large number
of pages, and also drastically reduces page load time, which is
essential for SEO.

Caching happens in two forms:

 1. by using the `--disk-cache=true` option of phantomjs
 2. by actually caching the rendered html in the database

Set `Spiderable.CACHE_TIME` to the desired lifetime of the database
cache in ms. Default if unset: 30 days.

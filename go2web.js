function usage() {
    console.log(`go2web – tiny fetcher & searcher
  
    go2web -u <URL>         fetch URL
    go2web -s <search>      search
    go2web -h               help`);
    process.exit(0);
  }
  
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h')) usage();
  
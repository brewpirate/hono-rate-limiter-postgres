import { PoolOptionsExplicit } from "postgres-pool";

export type Options = {
    /**
      * @param config {any} - The database configuration as specified in https://node-postgres.com/apis/client.
    */
      config: PoolOptionsExplicit,
      /**
       * @param prefix {string} - The unique name of the session. This is useful when applying multiple rate limiters with multiple stores.
       */
      prefix: string,
      storeType: 'summary' | 'detailed';
    
    }